import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DownloadIcon, UploadCloudIcon, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Type for file data from file system
interface FileSystemFile {
  name: string;
  size: string;
}

// Type for database file metadata
interface DbFile {
  key: string;
  fileName: string;
  timestamp: number;
}

export default function DirectDownload() {
  const [files, setFiles] = useState<FileSystemFile[]>([]);
  const [dbFiles, setDbFiles] = useState<DbFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  
  // Fetch both regular files and database files
  const fetchFiles = () => {
    setLoading(true);
    
    // Fetch available files from file system
    fetch('/api/videos/available-files')
      .then(res => res.json())
      .then(data => {
        setFiles(data.files || []);
        
        // After getting file system files, fetch database files
        return fetch('/api/videos/db-files');
      })
      .then(res => res.json())
      .then(data => {
        // Since we only get keys back, we need to extract file name from the key
        const dbFiles = (data.keys || []).map((key: string) => {
          // Extract the file name from the key pattern: video-{nanoid}-{timestamp}
          const parts = key.split('-');
          const timestamp = parseInt(parts[parts.length - 1], 10);
          return {
            key,
            fileName: `Video from ${new Date(timestamp).toLocaleDateString()}`,
            timestamp
          };
        });
        
        // Sort by most recent first
        dbFiles.sort((a, b) => b.timestamp - a.timestamp);
        
        setDbFiles(dbFiles);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching files:', err);
        setLoading(false);
      });
  };
  
  useEffect(() => {
    fetchFiles();
  }, []);
  
  // Handle direct download from file system
  const handleDownload = (fileName: string) => {
    window.open(`/api/videos/direct-download/${fileName}`, '_blank');
  };
  
  // Handle download from database
  const handleDbDownload = (fileKey: string) => {
    window.open(`/api/videos/db-download/${fileKey}`, '_blank');
  };
  
  // Upload file to database for more reliable downloads
  const handleUploadToDb = async (fileName: string) => {
    setUploadingFile(fileName);
    setUploading(true);
    
    try {
      const response = await fetch('/api/videos/upload-to-db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filename: fileName })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload file');
      }
      
      toast({
        title: "Upload successful",
        description: "Your video has been uploaded to the database for more reliable downloads.",
        duration: 5000
      });
      
      // Refresh the file lists
      fetchFiles();
    } catch (error) {
      console.error('Error uploading to database:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
        duration: 5000
      });
    } finally {
      setUploadingFile(null);
      setUploading(false);
    }
  };
  
  if (loading) {
    return (
      <Card className="p-6 my-4">
        <h2 className="text-xl font-bold mb-4">Available Downloads</h2>
        <p>Loading available files...</p>
      </Card>
    );
  }
  
  if (files.length === 0 && dbFiles.length === 0) {
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
        If your download doesn't start automatically, you can download any of these files directly.
      </p>
      
      {files.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mb-2">Local Files</h3>
          <div className="space-y-3 mb-6">
            {files.map((file, index) => (
              <div key={index} className="p-3 bg-gray-50 rounded border flex justify-between items-center">
                <div>
                  <div className="font-medium">{file.name}</div>
                  <div className="text-sm text-gray-500">{file.size}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    className="flex items-center gap-2"
                    onClick={() => handleUploadToDb(file.name)}
                    disabled={uploading}
                  >
                    <UploadCloudIcon className="h-4 w-4" />
                    {uploadingFile === file.name ? 'Uploading...' : 'Upload to DB'}
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex items-center gap-2"
                    onClick={() => handleDownload(file.name)}
                  >
                    <DownloadIcon className="h-4 w-4" />
                    <span>Download</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      
      {dbFiles.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mb-2">Database Files (More Reliable)</h3>
          <div className="space-y-3">
            {dbFiles.map((file, index) => (
              <div key={index} className="p-3 bg-blue-50 rounded border flex justify-between items-center">
                <div>
                  <div className="font-medium">{file.fileName}</div>
                  <div className="text-sm text-gray-500 flex items-center gap-1">
                    <Database className="h-3 w-3" />
                    <span>Stored in Replit Database</span>
                  </div>
                </div>
                <Button 
                  variant="default" 
                  className="flex items-center gap-2"
                  onClick={() => handleDbDownload(file.key)}
                >
                  <DownloadIcon className="h-4 w-4" />
                  <span>Download</span>
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}