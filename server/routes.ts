import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getYouTubeVideoInfo, downloadYouTubeVideo, formatDuration } from "./youtube-dl";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import * as replitDb from "./replit-db";
import { log } from "./vite";

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
  
  // Initialize database connection (no specific init needed for Replit DB)
  try {
    log("Replit database connection initialized", "db");
  } catch (error) {
    log(`Failed to initialize database: ${error instanceof Error ? error.message : "Unknown error"}`, "db");
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
    console.log(`Download request received for ID: ${downloadId}`);
    
    const download = activeDownloads.get(downloadId);
    if (!download) {
      console.error(`Download ${downloadId} not found in active downloads map`);
      return res.status(404).json({ error: "Download not found - please try downloading again" });
    }
    
    // Check if the file actually exists
    if (!fs.existsSync(download.downloadPath)) {
      console.error(`File not found at path: ${download.downloadPath}`);
      
      // Try finding the file with a similar name pattern
      const fileDir = path.dirname(download.downloadPath);
      const fileBaseName = path.basename(download.downloadPath);
      const filePrefix = fileBaseName.split('-').slice(0, 2).join('-');
      
      console.log(`Looking for alternative files with prefix: ${filePrefix} in ${fileDir}`);
      let alternativeFile = null;
      
      try {
        const files = fs.readdirSync(fileDir);
        // Find the most recent mp4 file matching the pattern
        const matchingFiles = files
          .filter(f => f.startsWith(filePrefix) && f.endsWith('.mp4') && !f.includes('.part-'))
          .map(f => ({ name: f, stats: fs.statSync(path.join(fileDir, f)) }))
          .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
          
        if (matchingFiles.length > 0) {
          alternativeFile = path.join(fileDir, matchingFiles[0].name);
          console.log(`Found alternative file: ${alternativeFile}`);
        }
      } catch (err: unknown) {
        console.error(`Error looking for alternative files: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
      
      if (!alternativeFile) {
        return res.status(404).json({ error: "Download file not found on server - please try downloading again" });
      }
      
      // Use the alternative file instead
      download.downloadPath = alternativeFile;
    }
    
    // Get file size to check if it's a valid file
    let stats;
    try {
      stats = fs.statSync(download.downloadPath);
      if (stats.size === 0) {
        console.error(`File is empty: ${download.downloadPath}`);
        return res.status(500).json({ error: "Downloaded file is empty - please try downloading again" });
      }
    } catch (err: unknown) {
      console.error(`Error checking file stats: ${err instanceof Error ? err.message : "Unknown error"}`);
      return res.status(500).json({ error: "Error accessing download file - please try downloading again" });
    }
    
    console.log(`Serving file: ${download.downloadPath}, size: ${stats.size} bytes`);
    
    storage.getVideoInfo(download.videoId)
      .then(videoInfo => {
        let fileName = `youtube-video-${download.videoId}.mp4`;
        if (videoInfo && videoInfo.title) {
          fileName = `${videoInfo.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
        }
        
        console.log(`Setting filename for download: ${fileName}`);
        
        // Set headers for file download
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", stats.size);
        
        // Create a read stream with appropriate error handling
        const fileStream = fs.createReadStream(download.downloadPath);
        
        // Handle errors during streaming
        fileStream.on('error', (err) => {
          console.error(`Error streaming file: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error streaming file - please try downloading again" });
          } else {
            res.end();
          }
        });
        
        // Set up timeout for the response
        res.setTimeout(120000, () => {
          console.log('Response timeout - client may have disconnected');
          res.end();
        });
        
        // Pipe the file to the response
        fileStream.pipe(res);
        
        // When download completes, clean up
        fileStream.on("end", () => {
          console.log(`Finished streaming file: ${download.downloadPath}`);
          
          // Use setTimeout to ensure file is fully sent before deletion
          // This is important for large files
          setTimeout(() => {
            try {
              // Check if we should delete the file (not for now - keep for debugging)
              // if (fs.existsSync(download.downloadPath)) {
              //   fs.unlinkSync(download.downloadPath);
              //   console.log(`Deleted file: ${download.downloadPath}`);
              // }
              
              // We'll keep the download in the active downloads map for a short while
              // in case the user needs to download again
              setTimeout(() => {
                activeDownloads.delete(downloadId);
                console.log(`Removed download ${downloadId} from active downloads map`);
              }, 300000); // Remove from active downloads after 5 minutes
              
            } catch (error) {
              console.error("Error in post-download cleanup:", error);
            }
          }, 5000); // Wait 5 seconds before cleanup
        });
      })
      .catch(error => {
        console.error("Error serving download:", error);
        return res.status(500).json({ error: "Failed to prepare download" });
      });
  });

  // API route to get a list of available downloaded files
  app.get("/api/videos/available-files", (req, res) => {
    try {
      const tempDir = path.join(process.cwd(), "temp");
      const files = fs.readdirSync(tempDir)
        .filter(file => file.endsWith('.mp4') && !file.includes('.part-') && 
                !file.includes('.f') && !file.includes('.temp'))
        .map(file => {
          const stats = fs.statSync(path.join(tempDir, file));
          const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
          
          return {
            name: file,
            size: `${fileSizeInMB} MB`
          };
        })
        .sort((a, b) => {
          // Sort by newest first (based on timestamp in filename)
          const timeA = parseInt(a.name.split('-')[2]?.split('.')[0] || '0', 10);
          const timeB = parseInt(b.name.split('-')[2]?.split('.')[0] || '0', 10);
          return timeB - timeA;
        });
      
      res.json({ files });
    } catch (error) {
      console.error("Error getting available files:", error instanceof Error ? error.message : "Unknown error");
      res.status(500).json({ error: "Failed to get available files" });
    }
  });
  
  // API route to directly download a specific file
  app.get("/api/videos/direct-download/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      const filePath = path.join(process.cwd(), "temp", filename);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        return res.status(500).json({ error: "File is empty" });
      }
      
      console.log(`Direct serving file: ${filePath}, size: ${stats.size} bytes`);
      
      // Set headers for file download
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", stats.size);
      
      // Stream file to client
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
      // Don't delete the file after direct download
    } catch (error) {
      console.error("Error direct downloading file:", error instanceof Error ? error.message : "Unknown error");
      res.status(500).json({ error: "Failed to download file" });
    }
  });
  
  return httpServer;
}
