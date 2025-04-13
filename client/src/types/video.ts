export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  views: string;
  formats: VideoFormat[];
}

export interface VideoFormat {
  format_id: string;
  format: string;
  quality: string;
  ext: string;
  resolution?: string;
  filesize: number;
  filesize_approx?: number;
}

export interface DownloadProgress {
  percent: number;
  downloaded_bytes: number;
  total_bytes: number;
}
