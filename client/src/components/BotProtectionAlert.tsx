import { 
  Alert,
  AlertDescription,
  AlertTitle
} from "@/components/ui/alert";
import { AlertCircle, ExternalLink } from "lucide-react";
import { Link } from "@/components/ui/link";

export default function BotProtectionAlert() {
  return (
    <Alert variant="destructive" className="mb-6">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>YouTube Bot Protection Detected</AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-2">
          YouTube has detected our application as automated traffic and is requiring CAPTCHA verification.
          This commonly happens with video downloaders and other automation tools.
        </p>
        <p className="mb-2">
          <strong>Try these solutions:</strong>
        </p>
        <ul className="list-disc pl-5 mb-2 space-y-1">
          <li>Try a different video (some videos are less protected than others)</li>
          <li>Try again after a few minutes</li>
          <li>Use a shorter video (smaller videos are less likely to trigger protection)</li>
        </ul>
        <p>
          <Link 
            href="https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp" 
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-red-600 hover:text-red-800"
          >
            Learn more about YouTube bot detection
            <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}