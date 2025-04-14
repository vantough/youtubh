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
  
  // Set up periodic cleanup of temp directory
  const cleanupTempFiles = () => {
    console.log("Running scheduled temp directory cleanup...");
    try {
      // Get all files in temp directory
      const files = fs.readdirSync(tempDir);
      
      // Get current active download paths to avoid deleting in-use files
      const activeFilePaths = new Set<string>();
      activeDownloads.forEach(download => {
        activeFilePaths.add(download.downloadPath);
      });
      
      let deletedCount = 0;
      let totalSize = 0;
      
      // Check each file
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        
        // Skip if this is an active download
        if (activeFilePaths.has(filePath)) {
          console.log(`Skipping active download: ${file}`);
          continue;
        }
        
        try {
          // Get file stats
          const stats = fs.statSync(filePath);
          
          // Only delete files older than 30 minutes (1800000ms)
          const fileAge = Date.now() - stats.mtimeMs;
          if (fileAge > 1800000) {
            totalSize += stats.size;
            fs.unlinkSync(filePath);
            deletedCount++;
            console.log(`Deleted old temp file: ${file} (${Math.round(stats.size / 1024)} KB, ${Math.round(fileAge / 60000)} minutes old)`);
          }
        } catch (error) {
          console.error(`Error processing temp file ${file}:`, error);
        }
      }
      
      if (deletedCount > 0) {
        console.log(`Cleanup complete: Removed ${deletedCount} files, freed ${Math.round(totalSize / (1024 * 1024))} MB of space`);
      } else {
        console.log("No files needed cleanup");
      }
    } catch (error) {
      console.error("Error during temp directory cleanup:", error);
    }
  };
  
  // Run cleanup on startup
  cleanupTempFiles();
  
  // Set up interval to clean temp files every 15 minutes
  const cleanupInterval = setInterval(cleanupTempFiles, 15 * 60 * 1000);

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
      // Start the download process. The progress callback will be used to update the
      // progress for the client. Note: Download isn't truly complete at 100%.
      // We need to keep track of both download completion AND file processing.
      downloadYouTubeVideo(
        videoId, 
        formatId, 
        downloadPath,
        (progress) => {
          // Update the download progress
          const download = activeDownloads.get(downloadId);
          if (download) {
            console.log(`Download ${downloadId} progress: ${progress.percent}%`);
            
            // For the progress from 0-100%, spread it across 0-90% for the user,
            // so we reserve the last 10% for the ffmpeg merging process
            let adjustedPercent = progress.percent;
            
            if (progress.percent === 100) {
              // When at 100%, we're actually at 90% (audio/video downloaded but not merged)
              adjustedPercent = 90;
              console.log(`Download finished, but still merging audio/video. Setting display progress to ${adjustedPercent}%`);
            } else if (progress.percent > 0) {
              // Scale progress to fit in 0-90% range
              adjustedPercent = Math.floor(progress.percent * 0.9);
            }
            
            activeDownloads.set(downloadId, {
              ...download,
              percent: adjustedPercent
            });
          }
        }
      )
      .then(() => {
        // This is called after the entire process is complete (download + ffmpeg merging)
        console.log(`Download ${downloadId} is fully complete, including merging`);
        
        // Check if file exists and is valid
        if (fs.existsSync(downloadPath)) {
          const stats = fs.statSync(downloadPath);
          console.log(`Final file size: ${stats.size} bytes`);
          
          if (stats.size > 0) {
            // Now we can set the progress to 100% to indicate true completion
            const download = activeDownloads.get(downloadId);
            if (download) {
              activeDownloads.set(downloadId, {
                ...download,
                percent: 100
              });
            }
          }
        }
      })
      .catch(error => {
        console.error(`Download ${downloadId} failed:`, error);
        
        // Set progress to -1 to indicate error
        const download = activeDownloads.get(downloadId);
        if (download) {
          activeDownloads.set(downloadId, {
            ...download,
            percent: -1
          });
        }
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
            // Keep the download info for longer to allow the browser to request the file
            // The user may take some time to click the download button
            setTimeout(() => {
              console.log(`Cleaning up download ${downloadId} from active downloads map`);
              activeDownloads.delete(downloadId);
            }, 5 * 60 * 1000); // Keep for 5 minutes instead of 5 seconds
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
    
    // First, check if this is a HEAD request (for checking if the file exists)
    const isHeadRequest = req.method === 'HEAD';
    console.log(`Request type: ${req.method}`);
    
    // Make sure we have a download with this ID
    const download = activeDownloads.get(downloadId);
    if (!download) {
      console.error(`Download ID not found: ${downloadId}`);
      return res.status(404).json({ error: "Download not found" });
    }
    
    console.log(`Download found with path: ${download.downloadPath}`);
    
    // Check if the file actually exists
    if (!fs.existsSync(download.downloadPath)) {
      console.error(`File not found at path: ${download.downloadPath}`);
      return res.status(404).json({ error: "Download file not found on server" });
    }
    
    // Get file size to check if it's a valid file
    let stats;
    try {
      stats = fs.statSync(download.downloadPath);
      if (stats.size === 0) {
        console.error(`Empty file found: ${download.downloadPath}`);
        return res.status(500).json({ error: "Downloaded file is empty" });
      }
      console.log(`File exists with size: ${stats.size} bytes`);
    } catch (error) {
      console.error(`Error checking file stats: ${error}`);
      return res.status(500).json({ error: "Error accessing file" });
    }
    
    // For HEAD requests, we just need to respond with a success status
    if (isHeadRequest) {
      console.log(`HEAD request successful for: ${downloadId}`);
      return res.status(200).end();
    }
    
    // For GET requests, serve the file
    console.log(`Serving file: ${download.downloadPath}, size: ${stats.size} bytes`);
    
    // Get video info to determine filename
    storage.getVideoInfo(download.videoId)
      .then(videoInfo => {
        let fileName = `youtube-video-${download.videoId}.mp4`;
        if (videoInfo && videoInfo.title) {
          fileName = `${videoInfo.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
        }
        
        console.log(`Using filename: ${fileName} for download`);
        
        // Set headers for file download
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", stats.size);
        
        // Create a read stream for the file
        try {
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
          
          // Track bytes sent
          let bytesSent = 0;
          fileStream.on('data', (chunk) => {
            bytesSent += chunk.length;
            // Log progress for large files
            if (stats.size > 10 * 1024 * 1024 && bytesSent % (5 * 1024 * 1024) === 0) { // log every 5MB
              console.log(`Download progress: ${Math.round((bytesSent / stats.size) * 100)}%`);
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
              } catch (error) {
                console.error("Error cleaning up download:", error);
              }
            }, 2000); // Wait longer before deleting
          });
          
          // Even if the download finishes successfully, keep the download info in the map for a while
          // This helps if the browser makes a second request or if the first attempt fails
          setTimeout(() => {
            console.log(`Removing download ${downloadId} from active downloads`);
            activeDownloads.delete(downloadId);
          }, 60000); // Keep for 1 minute after serving successfully
        } catch (error) {
          console.error(`Error creating file stream: ${error}`);
          return res.status(500).json({ error: "Could not read the file" });
        }
      })
      .catch(error => {
        console.error("Error serving download:", error);
        return res.status(500).json({ error: "Failed to prepare download" });
      });
  });

  // Set up cleanup for the interval when server shuts down
  httpServer.on('close', () => {
    console.log("Server shutting down, clearing temp file cleanup interval");
    clearInterval(cleanupInterval);
  });
  
  return httpServer;
}
