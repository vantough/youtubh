import { Card, CardContent } from "@/components/ui/card";

export default function Instructions() {
  return (
    <Card className="mt-8">
      <CardContent className="p-6">
        <h3 className="font-bold text-lg mb-4 text-gray-600">How to use:</h3>
        <ol className="list-decimal list-inside space-y-2 text-gray-600">
          <li>Paste a valid YouTube video URL in the input field above</li>
          <li>Click the "Fetch" button to load video information</li>
          <li>Select your preferred resolution from the dropdown menu</li>
          <li>Click "Download" and wait for the download to complete</li>
          <li>The file will be saved to your default downloads folder</li>
        </ol>
        <div className="mt-4 p-3 bg-yellow-100 bg-opacity-50 rounded-md">
          <p className="text-sm text-yellow-800">
            <span className="font-bold">Note:</span> This tool is for personal use only. Please respect copyright laws and YouTube's Terms of Service.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
