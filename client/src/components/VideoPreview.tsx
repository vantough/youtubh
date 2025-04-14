import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { VideoInfo, VideoFormat } from "@/types/video";
import { useToast } from "@/hooks/use-toast";
import { DownloadIcon, ClockIcon, EyeIcon, CheckCircle } from "lucide-react";

interface VideoPreviewProps {
  videoData: VideoInfo;
  downloadProgress: number;
  isDownloading: boolean;
  setIsDownloading: (isDownloading: boolean) => void;
  updateDownloadProgress: (progress: number) => void;
}

export default function VideoPreview({ 
  videoData, 
  downloadProgress, 
  isDownloading,
  setIsDownloading,
  updateDownloadProgress 
}: VideoPreviewProps) {
  const [selectedResolution, setSelectedResolution] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isMP3Download, setIsMP3Download] = useState(false);
  const { toast } = useToast();

  // Set initial resolution when video data loads
  useEffect(() => {
    if (videoData && videoData.formats && videoData.formats.length > 0) {
      // Get all MP4 formats with a resolution
      const mp4Formats = videoData.formats.filter(format => 
        format.ext === "mp4" && format.resolution
      );
      
      let bestFormat;
      
      // First try to find 720p format as a good default balance of quality and size
      bestFormat = mp4Formats.find(format => format.resolution?.includes("720"));
      
      // If no 720p, try 480p
      if (!bestFormat) {
        bestFormat = mp4Formats.find(format => format.resolution?.includes("480"));
      }
      
      // If still no match, try any mp4 with resolution
      if (!bestFormat && mp4Formats.length > 0) {
        bestFormat = mp4Formats[0];
      }
      
      // Last resort, use any format
      if (!bestFormat) {
        bestFormat = videoData.formats[0];
      }
      
      // Set the selected resolution
      setSelectedResolution(bestFormat.format_id);
      setSelectedFormat(bestFormat);
      
      console.log(`Selected format: ${bestFormat.format_id} - ${bestFormat.resolution || "Unknown"} (${bestFormat.ext})`);
    }
  }, [videoData]);

  useEffect(() => {
    if (videoData && videoData.formats) {
      const format = videoData.formats.find(f => f.format_id === selectedResolution);
      if (format) {
        setSelectedFormat(format);
      }
    }
  }, [selectedResolution, videoData]);

  const handleResolutionChange = (value: string) => {
    setSelectedResolution(value);
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return "Unknown size";
    
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Byte";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
  };

  const startDownloadEventSource = (downloadId: string) => {
    const eventSource = new EventSource(`/api/videos/download-progress/${downloadId}`);
    let progressTimeout: NodeJS.Timeout | null = null;
    let stuckCounter = 0;
    
    // Reset progress timeout
    const resetProgressTimeout = () => {
      if (progressTimeout) {
        clearTimeout(progressTimeout);
      }
      
      // If we're stuck at 0% for more than 30 seconds, show a helpful message
      progressTimeout = setTimeout(() => {
        if (stuckCounter >= 5) {
          toast({
            title: "Still working",
            description: "The download is taking longer than expected. Please be patient...",
            duration: 5000,
          });
        }
        stuckCounter++;
      }, 6000); // Check every 6 seconds
    };
    
    // Start initial timeout
    resetProgressTimeout();
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("EventSource data:", data);
        
        // If we get a non-zero progress, reset the stuck counter
        if (data.percent > 0) {
          stuckCounter = 0;
        }
        
        // Reset timeout since we received a message
        resetProgressTimeout();
        
        // Update the progress
        updateDownloadProgress(data.percent);
        
        if (data.percent >= 100) {
          console.log("Download reached 100%, closing event source");
          eventSource.close();
          
          if (progressTimeout) {
            clearTimeout(progressTimeout);
          }
          
          // Need to explicitly update states in a predictable order
          // This ensures React will properly re-render with the new state
          setTimeout(() => {
            setIsDownloading(false);
            setShowProgress(false);
            
            // Always show the download button when the server-side download is complete
            setDownloadComplete(true);
            setDownloadId(downloadId);
            
            // If the server indicates completion with a filename, save it
            if (data.fileName) {
              setFileName(data.fileName);
            }
            
            console.log("Updated download state:", { 
              downloadComplete: true,
              isMP3: isMP3Download,
              downloadId,
              fileName: data.fileName || (isMP3Download ? 'youtube-audio.mp3' : 'youtube-video.mp4')
            });
            
            toast({
              title: "Processing complete",
              description: isMP3Download 
                ? "Your MP3 audio is ready to download to your computer. Click the green button below."
                : "Your video is ready to download to your computer. Click the green button below.",
              duration: 5000,
            });
          }, 300);
        }
      } catch (error) {
        console.error("Error parsing event data:", error);
      }
    };
    
    eventSource.onerror = () => {
      console.error("EventSource error occurred");
      eventSource.close();
      
      // Clear any pending timeouts
      if (progressTimeout) {
        clearTimeout(progressTimeout);
      }
      
      setIsDownloading(false);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to receive download progress updates.",
      });
    };
    
    return eventSource;
  };

  const handleSaveToComputer = () => {
    if (!downloadId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Download ID is missing. Please try downloading again.",
      });
      return;
    }
    
    // Log the download attempt
    console.log(`Initiating file download for ID: ${downloadId}, filename: ${fileName || 'youtube-video.mp4'}`);
    
    // Create the download URL with the specific download ID
    const downloadUrl = `/api/videos/download/${downloadId}`;
    
    // Show a toast to inform user the download is starting
    toast({
      title: "Starting download",
      description: "Preparing your file...",
    });
    
    // Use fetch to check if the file is available first
    fetch(downloadUrl, { method: 'HEAD' })
      .then(async response => {
        if (!response.ok) {
          // Try to get more detailed error information
          let errorMsg = `Server returned ${response.status}: ${response.statusText}`;
          
          try {
            // Attempt to parse JSON error message
            const errorData = await response.json();
            if (errorData && errorData.error) {
              errorMsg = errorData.error;
            }
          } catch (e) {
            // If we can't parse JSON, just use the default error message
          }
          
          throw new Error(errorMsg);
        }
        
        // File exists and is accessible, trigger the download
        const link = document.createElement('a');
        link.href = downloadUrl;
        // We let the server set the filename via Content-Disposition header
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Only reset download state after successfully starting the download
        setTimeout(() => {
          setDownloadComplete(false);
          setDownloadId(null);
          setFileName(null);
          setShowProgress(false);
        }, 2000); // Give a bit more time for download to start
        
        toast({
          title: "Download started",
          description: isMP3Download 
            ? "Your MP3 audio should begin downloading soon."
            : "Your video should begin downloading soon.",
        });
      })
      .catch(error => {
        console.error("Download error:", error);
        
        // Show a more helpful error message to the user
        toast({
          variant: "destructive",
          title: "Download Error",
          description: error.message || "Could not download the file. The server may have removed it or the download timed out. Please try downloading again.",
        });
        
        // If the error is because the file was removed (download timeout), suggest trying again
        if (error.message && error.message.includes("not found")) {
          toast({
            title: "Try Again",
            description: "Your download may have timed out. Try downloading the video again.",
            duration: 10000,
          });
          
          // Reset the download state so the user can try again
          setDownloadComplete(false);
          setDownloadId(null);
          setFileName(null);
          setShowProgress(false);
        }
      });
  };
  
  const handleMP3Download = async () => {
    // If user is already downloading something, don't start a new download
    if (isDownloading) return;
    
    // Reset previous download info
    setDownloadComplete(false);
    setDownloadId(null);
    setFileName(null);
    
    // Set MP3 download mode
    setIsMP3Download(true);
    setIsDownloading(true);
    setShowProgress(true);
    updateDownloadProgress(0);
    
    try {
      const res = await apiRequest("POST", "/api/videos/download", { 
        videoId: videoData.id,
        isMP3: true
      });
      
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (data.downloadId) {
        setDownloadId(data.downloadId);
        const eventSource = startDownloadEventSource(data.downloadId);
        
        // Clean up event source when component unmounts
        return () => {
          eventSource.close();
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start MP3 download";
      toast({
        variant: "destructive",
        title: "MP3 Download Error",
        description: errorMessage,
      });
      setIsDownloading(false);
      setShowProgress(false);
    }
  };

  const handleDownload = async () => {
    // If download is already complete, just trigger browser download
    if (downloadComplete && downloadId) {
      handleSaveToComputer();
      return;
    }
    
    if (!selectedFormat || isDownloading) return;
    
    // Reset previous download info
    setDownloadComplete(false);
    setDownloadId(null);
    setFileName(null);
    
    // Set video download mode (not MP3)
    setIsMP3Download(false);
    setIsDownloading(true);
    setShowProgress(true);
    updateDownloadProgress(0);
    
    try {
      const res = await apiRequest("POST", "/api/videos/download", { 
        videoId: videoData.id,
        formatId: selectedFormat.format_id,
        isMP3: false
      });
      
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (data.downloadId) {
        setDownloadId(data.downloadId);
        const eventSource = startDownloadEventSource(data.downloadId);
        
        // Clean up event source when component unmounts
        return () => {
          eventSource.close();
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start download";
      toast({
        variant: "destructive",
        title: "Download Error",
        description: errorMessage,
      });
      setIsDownloading(false);
      setShowProgress(false);
    }
  };

  if (!videoData) return null;

  return (
    <Card className="overflow-hidden mb-6">
      <div className="md:flex">
        <div className="md:w-2/5">
          <img 
            src={videoData.thumbnail} 
            alt={videoData.title} 
            className="w-full h-full object-cover"
          />
        </div>
        <div className="p-6 md:w-3/5">
          <h2 className="text-xl font-bold mb-2 truncate">
            {videoData.title}
          </h2>
          <div className="flex items-center mb-4 text-gray-600">
            <span className="flex items-center mr-4">
              <EyeIcon className="h-5 w-5 mr-1" />
              <span>{videoData.views}</span>
            </span>
            <span className="flex items-center">
              <ClockIcon className="h-5 w-5 mr-1" />
              <span>{videoData.duration}</span>
            </span>
          </div>
          
          <div className="mb-4">
            <label htmlFor="resolution" className="block text-sm font-medium text-gray-600 mb-2">
              Select Resolution
            </label>
            <Select value={selectedResolution} onValueChange={handleResolutionChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select resolution" />
              </SelectTrigger>
              <SelectContent>
                {/* Filter to only show video formats that work well with audio merging */}
                {videoData.formats
                  .filter(format => {
                    // Include common video formats
                    if (format.ext === "mp4" && format.resolution) {
                      return true;
                    }
                    
                    // Include high-quality audio formats
                    if (format.ext === "m4a" && !format.resolution) {
                      return true;
                    }
                    
                    // For other formats, only show if they have a valid format ID and extension
                    return format.format_id && (format.ext === "mp4" || format.ext === "webm");
                  })
                  .map(format => (
                    <SelectItem 
                      key={format.format_id} 
                      value={format.format_id}
                    >
                      {format.resolution || "Audio only"} ({format.ext.toUpperCase()})
                      {format.quality ? ` - ${format.quality}` : ''}
                    </SelectItem>
                  ))
                }
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
            {downloadComplete && downloadId ? (
              <Button 
                className="bg-green-600 hover:bg-green-700"
                onClick={handleSaveToComputer}
              >
                <DownloadIcon className="h-5 w-5 mr-2" />
                <span>Save to your computer</span>
              </Button>
            ) : (
              <>
                <Button 
                  className="bg-[#065FD4] hover:bg-blue-700"
                  onClick={handleDownload}
                  disabled={isDownloading}
                >
                  <DownloadIcon className="h-5 w-5 mr-2" />
                  <span>
                    {isDownloading 
                      ? downloadProgress < 90 
                        ? "Downloading..." 
                        : "Merging audio & video..." 
                      : "Download Video"
                    }
                  </span>
                </Button>
                
                <Button 
                  className="bg-[#FF0000] hover:bg-red-700"
                  onClick={handleMP3Download}
                  disabled={isDownloading}
                >
                  <DownloadIcon className="h-5 w-5 mr-2" />
                  <span>Download MP3</span>
                </Button>
              </>
            )}
            
            <div className="mt-3 sm:mt-0 sm:ml-4 text-gray-600">
              <span className="text-sm">File size: </span>
              <span className="font-medium">
                {selectedFormat ? formatFileSize(selectedFormat.filesize || selectedFormat.filesize_approx) : "Unknown"}
              </span>
            </div>
          </div>
          
          {downloadComplete && downloadId && (
            <div className="mt-3 p-2 rounded bg-green-50 border border-green-200 flex items-center text-green-600">
              <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0" />
              <span className="text-sm font-medium">
                {isMP3Download 
                  ? "MP3 processing complete! Click the green button above to download to your computer."
                  : "Video processing complete! Click the green button above to download to your computer."
                }
              </span>
            </div>
          )}
        </div>
      </div>
      
      {showProgress && (
        <div className="p-6 pt-0">
          <div className="mb-2 flex justify-between items-center">
            <span className="text-sm font-medium text-gray-600">
              {downloadProgress < 90 
                ? isMP3Download ? "Downloading Audio" : "Downloading Video & Audio" 
                : downloadProgress < 100 
                  ? isMP3Download ? "Converting to MP3" : "Processing & Merging" 
                  : "Complete!"}
            </span>
            <span className="text-sm font-medium text-[#065FD4]">{downloadProgress}%</span>
          </div>
          <Progress value={downloadProgress} className="h-2.5" />
          
          {downloadProgress >= 90 && downloadProgress < 100 && (
            <div className="mt-2 text-xs text-gray-500">
              {isMP3Download 
                ? "This may take a moment as we extract and convert the audio to MP3."
                : "This may take a moment as we merge the audio and video tracks for the best quality."}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
