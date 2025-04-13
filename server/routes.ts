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
      
      // Create path for downloaded file with timestamp to avoid conflicts
      const timestamp = Date.now();
      const downloadPath = path.join(tempDir, `${videoId}-${formatId}-${timestamp}.mp4`);
      
      console.log(`Starting download process for ${videoId} with format ${formatId} to ${downloadPath}`);
      
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
            console.log(`Download ${downloadId} progress: ${progress.percent}%`);
            activeDownloads.set(downloadId, {
              ...download,
              percent: progress.percent
            });
          }
        }
      ).catch(error => {
        console.error(`Download ${downloadId} failed:`, error);
      });

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
    
    console.log(`Progress tracking started for download: ${downloadId}`);
    
    // Set up headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Check if download exists initially
    const initialDownload = activeDownloads.get(downloadId);
    if (!initialDownload) {
      console.error(`Download ${downloadId} not found when starting progress tracking`);
      res.write(`data: ${JSON.stringify({ error: "Download not found", percent: 0 })}\n\n`);
      return res.end();
    }
    
    // Function to send progress updates
    const sendProgress = () => {
      const download = activeDownloads.get(downloadId);
      
      if (!download) {
        console.error(`Download ${downloadId} was lost during progress tracking`);
        clearInterval(interval);
        res.write(`data: ${JSON.stringify({ error: "Download was lost during processing", percent: 0 })}\n\n`);
        return res.end();
      }
      
      // Send the current progress
      res.write(`data: ${JSON.stringify({ percent: download.percent })}\n\n`);
      
      // If download is complete, check the file and end connection
      if (download.percent >= 100) {
        clearInterval(interval);
        console.log(`Download ${downloadId} reached 100%, checking file...`);
        
        // Check if the file actually exists
        if (!fs.existsSync(download.downloadPath)) {
          console.error(`Download file missing at completion: ${download.downloadPath}`);
          res.write(`data: ${JSON.stringify({ 
            error: "Download file was not created properly",
            percent: 0
          })}\n\n`);
          return res.end();
        }
        
        // Check if the file has content
        try {
          const stats = fs.statSync(download.downloadPath);
          if (stats.size === 0) {
            console.error(`Download file is empty: ${download.downloadPath}`);
            res.write(`data: ${JSON.stringify({ 
              error: "Download file is empty",
              percent: 0
            })}\n\n`);
            return res.end();
          }
          
          console.log(`Download file validated: ${download.downloadPath}, size: ${stats.size} bytes`);
        } catch (error) {
          console.error(`Error checking file stats: ${error}`);
        }
        
        // Get the file name for the download
        storage.getVideoInfo(download.videoId)
          .then(videoInfo => {
            const fileName = videoInfo && videoInfo.title 
              ? `${videoInfo.title.replace(/[^a-z0-9]/gi, '_')}.mp4` 
              : `youtube-video-${download.videoId}.mp4`;
              
            console.log(`Sending completion event for ${downloadId} with filename: ${fileName}`);
            
            // Send final event with download complete
            res.write(`data: ${JSON.stringify({ 
              percent: 100, 
              fileName,
              completed: true 
            })}\n\n`);
            
            res.end();
          })
          .catch(error => {
            console.error(`Error finalizing download ${downloadId}:`, error);
            
            res.write(`data: ${JSON.stringify({ 
              percent: 100, 
              fileName: `youtube-video-${download.videoId}.mp4`,
              completed: true 
            })}\n\n`);
            
            res.end();
          })
          .finally(() => {
            // Keep the download info for a little while to allow the browser to request the file
            setTimeout(() => {
              console.log(`Cleaning up download ${downloadId} from active downloads map`);
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
      console.log(`Client disconnected from progress updates for ${downloadId}`);
      clearInterval(interval);
    });
  });

  // API route to serve downloaded file
  app.get("/api/videos/download/:downloadId", (req, res) => {
    const { downloadId } = req.params;
    const download = activeDownloads.get(downloadId);
    
    if (!download) {
      return res.status(404).json({ error: "Download not found" });
    }
    
    // Check if the file actually exists
    if (!fs.existsSync(download.downloadPath)) {
      console.error(`File not found at path: ${download.downloadPath}`);
      return res.status(404).json({ error: "Download file not found on server" });
    }
    
    // Get file size to check if it's a valid file
    const stats = fs.statSync(download.downloadPath);
    if (stats.size === 0) {
      return res.status(500).json({ error: "Downloaded file is empty" });
    }
    
    console.log(`Serving file: ${download.downloadPath}, size: ${stats.size} bytes`);
    
    storage.getVideoInfo(download.videoId)
      .then(videoInfo => {
        let fileName = `youtube-video-${download.videoId}.mp4`;
        if (videoInfo && videoInfo.title) {
          fileName = `${videoInfo.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
        }
        
        // Set headers for file download
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", stats.size);
        
        // Stream file to client
        const fileStream = fs.createReadStream(download.downloadPath);
        
        // Handle errors during streaming
        fileStream.on('error', (err) => {
          console.error(`Error streaming file: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error streaming file" });
          } else {
            res.end();
          }
        });
        
        // Pipe the file to the response
        fileStream.pipe(res);
        
        // Delete file and clean up after sending
        fileStream.on("end", () => {
          console.log(`Finished streaming file: ${download.downloadPath}`);
          // Use setTimeout to ensure file is fully sent before deletion
          setTimeout(() => {
            try {
              if (fs.existsSync(download.downloadPath)) {
                fs.unlinkSync(download.downloadPath);
                console.log(`Deleted file: ${download.downloadPath}`);
              }
              activeDownloads.delete(downloadId);
            } catch (error) {
              console.error("Error cleaning up download:", error);
            }
          }, 1000);
        });
      })
      .catch(error => {
        console.error("Error serving download:", error);
        return res.status(500).json({ error: "Failed to prepare download" });
      });
  });

  return httpServer;
}
