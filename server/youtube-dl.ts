import youtubedl from "youtube-dl-exec";
import { VideoInfo } from "../shared/schema";
import fs from "fs";
import path from "path";

interface YouTubeDlVideoInfo {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  view_count: number;
  formats: YouTubeDlFormat[];
  format_id?: string;
}

interface YouTubeDlFormat {
  format_id: string;
  format: string;
  ext: string;
  resolution?: string;
  filesize?: number;
  filesize_approx?: number;
  quality?: string;
}

interface ProgressCallback {
  (progress: { percent: number; downloaded_bytes: number; total_bytes: number }): void;
}

export async function getYouTubeVideoInfo(url: string): Promise<YouTubeDlVideoInfo> {
  try {
    // Get video info with available formats
    const result = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      // Using proper properties for youtube-dl-exec
      preferFreeFormats: true,
      // Adding cache dir to improve speed
      cacheDir: './youtube-dl-cache'
    });

    return result as unknown as YouTubeDlVideoInfo;
  } catch (error) {
    console.error("Error in youtube-dl:", error);
    throw new Error(`Failed to get video info: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function downloadYouTubeVideo(
  videoId: string, 
  formatId: string, 
  outputPath: string,
  progressCallback: ProgressCallback,
  isMP3: boolean = false
): Promise<void> {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`Starting download for ${isMP3 ? 'MP3 audio' : 'video'} ${videoId} ${isMP3 ? '' : `with format ${formatId}`}`);
    console.log(`Output path: ${outputPath}`);
    
    // Start downloading with progress tracking
    // Ensure temp directory exists
    try {
      if (!fs.existsSync(path.dirname(outputPath))) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      }
    } catch (error) {
      console.error("Error ensuring temp directory exists:", error);
    }
    
    // Different options for MP3 vs. video download
    const downloaderOptions: any = {
      output: outputPath,
      // Cache to improve speed
      cacheDir: './youtube-dl-cache',
      // Avoid rate limiting errors
      limitRate: '2M',
      // Allow retries
      retries: 10,
      // Don't remove intermediate files on error to help debugging
      keepFragments: true,
      // Additional debugging
      verbose: true
    };
    
    if (isMP3) {
      // MP3 audio download options
      downloaderOptions.extractAudio = true;
      downloaderOptions.audioFormat = 'mp3';
      downloaderOptions.audioQuality = 0; // 0 is best quality
      // Use best audio format available
      downloaderOptions.format = 'bestaudio';
      // Some additional options specific to audio extraction
      downloaderOptions.postprocessorArgs = 'ffmpeg:-q:a 0 -map a'; // High quality MP3
    } else {
      // Video download options
      // Use format-specific download with audio - This ensures we get both video and audio streams
      downloaderOptions.format = formatId + "+bestaudio[ext=m4a]/best";
      // Merge video and audio streams into a single file
      downloaderOptions.mergeOutputFormat = "mp4";
      // Important: Force enabling the postprocessor for proper audio/video merging
      downloaderOptions.postprocessorArgs = "ffmpeg:-c:v copy -c:a aac -b:a 192k";
      // Enable all postprocessors
      downloaderOptions.embedSubs = false;
    }
    
    const downloader = youtubedl.exec(url, downloaderOptions);

    if (!downloader.stdout || !downloader.stderr) {
      throw new Error("Failed to create download process");
    }

    // Parse progress information from stdout
    downloader.stdout.on("data", (data: Buffer) => {
      const output = data.toString();
      console.log(`youtube-dl stdout: ${output}`);
      
      // Parse progress percentage
      const progressMatch = output.match(/(\d+\.\d+)%/);
      if (progressMatch && progressMatch[1]) {
        const percent = parseFloat(progressMatch[1]);
        console.log(`Download progress: ${percent}%`);
        
        // Parse downloaded bytes and total bytes if available
        const bytesMatch = output.match(/(\d+\.\d+)(\w+) of (\d+\.\d+)(\w+)/);
        let downloaded_bytes = 0;
        let total_bytes = 0;
        
        if (bytesMatch) {
          // Convert to bytes based on unit
          const units = { B: 1, KiB: 1024, MiB: 1024 * 1024, GiB: 1024 * 1024 * 1024 };
          const downloadValue = parseFloat(bytesMatch[1]);
          const downloadUnit = bytesMatch[2] as keyof typeof units;
          const totalValue = parseFloat(bytesMatch[3]);
          const totalUnit = bytesMatch[4] as keyof typeof units;
          
          downloaded_bytes = downloadValue * (units[downloadUnit] || 1);
          total_bytes = totalValue * (units[totalUnit] || 1);
          
          console.log(`Downloaded: ${downloaded_bytes} bytes of ${total_bytes} bytes`);
        }
        
        progressCallback({
          percent,
          downloaded_bytes,
          total_bytes
        });
      }
    });

    // Handle any errors
    downloader.stderr.on("data", (data: Buffer) => {
      console.error(`youtube-dl stderr: ${data.toString()}`);
    });

    // Log when the process ends
    downloader.on('close', (code) => {
      console.log(`youtube-dl process exited with code ${code}`);
      
      // Check if file exists using the imported fs
      try {
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`Download file exists at ${outputPath}, size: ${stats.size} bytes`);
        } else {
          console.error(`Download file doesn't exist at ${outputPath}`);
        }
      } catch (error) {
        console.error('Error checking file status:', error);
      }
    });

    // Wait for download to complete - this is just the initial download, not the ffmpeg processing
    console.log("Waiting for download to complete...");
    
    // Create a promise that will resolve when the download process is actually complete
    return new Promise<void>((resolve, reject) => {
      // Set up a handler for when the process exits
      downloader.on('close', (code) => {
        console.log(`youtube-dl process exited with code ${code}`);
        
        // Check if file exists
        try {
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            
            if (stats.size > 0) {
              console.log(`Download successful! File exists at ${outputPath}, size: ${stats.size} bytes`);
              
              // Set progress to 100% when done
              progressCallback({
                percent: 100,
                downloaded_bytes: stats.size,
                total_bytes: stats.size
              });
              
              console.log("Download completed successfully");
              resolve(); // Resolve the promise when everything is done
            } else {
              console.error(`Download file exists but is empty: ${outputPath}`);
              reject(new Error("Download file is empty"));
            }
          } else {
            console.error(`Download file does not exist: ${outputPath}`);
            reject(new Error("Download file not found"));
          }
        } catch (error) {
          console.error("Error checking file:", error);
          reject(error);
        }
      });
      
      // Handle errors during the download process
      downloader.on('error', (error) => {
        console.error("Download process error:", error);
        reject(error);
      });
      
      // Wait for the command to finish
      downloader.then((result) => {
        console.log("Download command finished with result:", result);
        // We don't resolve here because we want to wait for the 'close' event
        // which happens after any post-processing (like ffmpeg)
      }).catch((error) => {
        console.error("Download command failed:", error);
        reject(error);
      });
    });
  } catch (error) {
    console.error("Error downloading video:", error);
    throw new Error(`Failed to download video: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export function formatDuration(seconds?: number): string {
  if (!seconds) return "Unknown";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  } else {
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
}
