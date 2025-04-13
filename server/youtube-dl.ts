import youtubedl from "youtube-dl-exec";
import { VideoInfo } from "../shared/schema";
import fs from "fs";

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
  progressCallback: ProgressCallback
): Promise<void> {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`Starting download for video ${videoId} with format ${formatId}`);
    console.log(`Output path: ${outputPath}`);
    
    // Start downloading with progress tracking
    // youtubedl-exec has different flags than we expected
    const downloader = youtubedl.exec(url, {
      output: outputPath,
      format: formatId,
      // Don't use progress flag as it doesn't exist
      cacheDir: './youtube-dl-cache',
      // Add rate limit to make it more stable
      limitRate: '1M',
      // Add retry options
      retries: 10
    });

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

    // Wait for download to complete
    console.log("Waiting for download to complete...");
    const result = await downloader;
    console.log("Download process finished with result:", result);
    
    // Set progress to 100% when done
    progressCallback({
      percent: 100,
      downloaded_bytes: 0,
      total_bytes: 0
    });
    
    console.log("Download completed successfully");
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
