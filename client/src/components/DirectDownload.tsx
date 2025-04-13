import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DownloadIcon } from "lucide-react";

export default function DirectDownload() {
  const [files, setFiles] = useState<{ name: string, size: string }[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // Fetch available files
    fetch('/api/videos/available-files')
      .then(res => res.json())
      .then(data => {
        setFiles(data.files || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching available files:', err);
        setLoading(false);
      });
  }, []);
  
  const handleDownload = (fileName: string) => {
    window.open(`/api/videos/direct-download/${fileName}`, '_blank');
  };
  
  if (loading) {
    return (
      <Card className="p-6 my-4">
        <h2 className="text-xl font-bold mb-4">Available Downloads</h2>
        <p>Loading available files...</p>
      </Card>
    );
  }
  
  if (files.length === 0) {
    return (
      <Card className="p-6 my-4">
        <h2 className="text-xl font-bold mb-4">Available Downloads</h2>
        <p>No downloaded files available.</p>
      </Card>
    );
  }
  
  return (
    <Card className="p-6 my-4">
      <h2 className="text-xl font-bold mb-4">Available Downloads</h2>
      <p className="mb-4 text-sm text-gray-600">
        If your download doesn't start automatically, you can download any of these files directly:
      </p>
      
      <div className="space-y-3">
        {files.map((file, index) => (
          <div key={index} className="p-3 bg-gray-50 rounded border flex justify-between items-center">
            <div>
              <div className="font-medium">{file.name}</div>
              <div className="text-sm text-gray-500">{file.size}</div>
            </div>
            <Button 
              variant="outline" 
              className="flex items-center gap-2"
              onClick={() => handleDownload(file.name)}
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download</span>
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}