import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getYouTubeVideoInfo, downloadYouTubeVideo, formatDuration } from "./youtube-dl";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";

// Track active downloads and their progress
const activeDownloads = new Map<string, {
  percent: number;
  downloadPath: string;
  videoId: string;
}>();

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Create temp directory for downloads
  const tempDir = path.join(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // API route to get video info
  app.post("/api/videos/info", async (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      const videoInfo = await getYouTubeVideoInfo(url);
      
      if (!videoInfo) {
        return res.status(404).json({ error: "Could not retrieve video information" });
      }

      // Format data to match our schema
      const formattedInfo = {
        id: videoInfo.id,
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        duration: formatDuration(videoInfo.duration),
        views: `${Math.round((videoInfo.view_count || 0) / 1000)}K views`,
        formats: videoInfo.formats.map(format => ({
          format_id: format.format_id,
          format: format.format,
          quality: format.quality || "unknown",
          ext: format.ext,
          resolution: format.resolution,
          filesize: format.filesize,
          filesize_approx: format.filesize_approx
        }))
      };

      // Store the video info for later use
      storage.storeVideoInfo(formattedInfo);

      res.json(formattedInfo);
    } catch (error) {
      console.error("Error fetching video info:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to fetch video information" 
      });
    }
  });

  // API route to download video
  app.post("/api/videos/download", async (req, res) => {
    try {
      const { videoId, formatId } = req.body;
      
      if (!videoId || !formatId) {
        return res.status(400).json({ error: "Video ID and format ID are required" });
      }

      // Get video info from storage
      const videoInfo = await storage.getVideoInfo(videoId);
      
      if (!videoInfo) {
        return res.status(404).json({ error: "Video information not found" });
      }

      // Generate a unique download ID
      const downloadId = nanoid();
      
      // Create path for downloaded file
      const downloadPath = path.join(tempDir, `${videoId}-${formatId}.download`);
      
      // Initialize download tracking
      activeDownloads.set(downloadId, {
        percent: 0,
        downloadPath,
        videoId
      });

      // Start the download process
      downloadYouTubeVideo(
        videoId, 
        formatId, 
        downloadPath,
        (progress) => {
          // Update the download progress
          const download = activeDownloads.get(downloadId);
          if (download) {
            activeDownloads.set(downloadId, {
              ...download,
              percent: progress.percent
            });
          }
        }
      );

      res.json({ downloadId });
    } catch (error) {
      console.error("Error starting download:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to start download" 
      });
    }
  });

  // API route to get download progress
  app.get("/api/videos/download-progress/:downloadId", (req, res) => {
    const { downloadId } = req.params;
    
    // Set up headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Function to send progress updates
    const sendProgress = () => {
      const download = activeDownloads.get(downloadId);
      
      if (!download) {
        clearInterval(interval);
        res.write(`data: ${JSON.stringify({ error: "Download not found" })}\n\n`);
        return res.end();
      }
      
      res.write(`data: ${JSON.stringify({ percent: download.percent })}\n\n`);
      
      // If download is complete, end connection and clean up
      if (download.percent >= 100) {
        clearInterval(interval);
        
        // Since we can't easily fix typescript types without major refactoring, 
        // let's use a simpler approach that doesn't rely on awaiting getVideoInfo
        storage.getVideoInfo(download.videoId)
          .then(videoInfo => {
            const fileName = videoInfo && videoInfo.title 
              ? `${videoInfo.title.replace(/[^a-z0-9]/gi, '_')}.mp4` 
              : `youtube-video-${download.videoId}.mp4`;
              
            // Send final event with download complete
            res.write(`data: ${JSON.stringify({ 
              percent: 100, 
              fileName,
              completed: true 
            })}\n\n`);
            
            res.end();
          })
          .catch(error => {
            console.error("Error finalizing download:", error);
            
            res.write(`data: ${JSON.stringify({ 
              percent: 100, 
              fileName: `youtube-video-${download.videoId}.mp4`,
              completed: true 
            })}\n\n`);
            
            res.end();
          })
          .finally(() => {
            setTimeout(() => {
              activeDownloads.delete(downloadId);
            }, 5000);
          });
          
        return; // Don't end response here, it will be ended in the promise chain
      }
    };
    
    // Send progress every second
    const interval = setInterval(sendProgress, 1000);
    sendProgress(); // Send initial progress
    
    // Clean up on client disconnect
    req.on("close", () => {
      clearInterval(interval);
    });
  });

  // API route to serve downloaded file
  app.get("/api/videos/download/:downloadId", (req, res) => {
    const { downloadId } = req.params;
    const download = activeDownloads.get(downloadId);
    
    if (!download || download.percent < 100) {
      return res.status(404).json({ error: "Download not found or not completed" });
    }
    
    storage.getVideoInfo(download.videoId)
      .then(videoInfo => {
        let fileName = `youtube-video-${download.videoId}.mp4`;
        if (videoInfo && videoInfo.title) {
          fileName = `${videoInfo.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
        }
        
        // Set headers for file download
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "application/octet-stream");
        
        // Stream file to client
        const fileStream = fs.createReadStream(download.downloadPath);
        fileStream.pipe(res);
        
        // Delete file and clean up after sending
        fileStream.on("end", () => {
          try {
            fs.unlinkSync(download.downloadPath);
            activeDownloads.delete(downloadId);
          } catch (error) {
            console.error("Error cleaning up download:", error);
          }
        });
      })
      .catch(error => {
        console.error("Error serving download:", error);
        return res.status(500).json({ error: "Failed to serve download" });
      });
  });

  return httpServer;
}
