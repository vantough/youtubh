import { useState } from "react";
import Header from "@/components/Header";
import UrlInput from "@/components/UrlInput";
import VideoPreview from "@/components/VideoPreview";
import Instructions from "@/components/Instructions";
import Footer from "@/components/Footer";
import LoadingIndicator from "@/components/LoadingIndicator";
import ErrorMessage from "@/components/ErrorMessage";
import { VideoInfo } from "@/types/video";

export default function Home() {
  const [videoData, setVideoData] = useState<VideoInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleVideoFetched = (video: VideoInfo) => {
    setVideoData(video);
    setError(null);
  };

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
    setVideoData(null);
  };

  const updateDownloadProgress = (progress: number) => {
    setDownloadProgress(progress);
  };

  return (
    <div className="bg-gray-100 min-h-screen">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Header />
        
        <UrlInput 
          onVideoFetched={handleVideoFetched} 
          onLoading={setIsLoading} 
          onError={handleError} 
        />

        {isLoading && <LoadingIndicator />}
        
        {error && <ErrorMessage error={error} />}
        
        {videoData && (
          <VideoPreview 
            videoData={videoData} 
            downloadProgress={downloadProgress}
            isDownloading={isDownloading}
            setIsDownloading={setIsDownloading}
            updateDownloadProgress={updateDownloadProgress}
          />
        )}
        
        <Instructions />
        <Footer />
      </div>
    </div>
  );
}
