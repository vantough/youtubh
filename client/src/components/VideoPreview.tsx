import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { VideoInfo, VideoFormat } from "@/types/video";
import { useToast } from "@/hooks/use-toast";
import { DownloadIcon, ClockIcon, EyeIcon } from "lucide-react";

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
  const { toast } = useToast();

  // Set initial resolution when video data loads
  useEffect(() => {
    if (videoData && videoData.formats && videoData.formats.length > 0) {
      // Find a format with both video and audio (mp4)
      const bestFormat = videoData.formats.find(format => 
        format.ext === "mp4" && format.resolution && format.resolution.includes("720")
      ) || videoData.formats[0];
      
      setSelectedResolution(bestFormat.format_id);
      setSelectedFormat(bestFormat);
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
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateDownloadProgress(data.percent);
      
      if (data.percent >= 100) {
        eventSource.close();
        setIsDownloading(false);
        setShowProgress(false);
        toast({
          title: "Download complete",
          description: "Your video has been downloaded successfully.",
        });
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      setIsDownloading(false);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to receive download progress updates.",
      });
    };
    
    return eventSource;
  };

  const handleDownload = async () => {
    if (!selectedFormat || isDownloading) return;
    
    setIsDownloading(true);
    setShowProgress(true);
    updateDownloadProgress(0);
    
    try {
      const res = await apiRequest("POST", "/api/videos/download", { 
        videoId: videoData.id,
        formatId: selectedFormat.format_id
      });
      
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (data.downloadId) {
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
                {videoData.formats
                  .filter(format => format.ext === "mp4" || format.ext === "mp3")
                  .map(format => (
                    <SelectItem 
                      key={format.format_id} 
                      value={format.format_id}
                    >
                      {format.resolution || "Audio only"} ({format.ext.toUpperCase()})
                    </SelectItem>
                  ))
                }
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:items-center">
            <Button 
              className="bg-[#065FD4] hover:bg-blue-700"
              onClick={handleDownload}
              disabled={isDownloading}
            >
              <DownloadIcon className="h-5 w-5 mr-2" />
              <span>Download</span>
            </Button>
            
            <div className="mt-3 sm:mt-0 sm:ml-4 text-gray-600">
              <span className="text-sm">File size: </span>
              <span className="font-medium">
                {selectedFormat ? formatFileSize(selectedFormat.filesize || selectedFormat.filesize_approx) : "Unknown"}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {showProgress && (
        <div className="p-6 pt-0">
          <div className="mb-2 flex justify-between items-center">
            <span className="text-sm font-medium text-gray-600">Download Progress</span>
            <span className="text-sm font-medium text-[#065FD4]">{downloadProgress}%</span>
          </div>
          <Progress value={downloadProgress} className="h-2.5" />
        </div>
      )}
    </Card>
  );
}
