import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './vite';

// Initialize the GCS client
const storage = new Storage();

// The bucket name will be set when we create/select a bucket
let bucketName: string | null = null;

/**
 * Set the bucket name to use for storage operations
 * @param name The bucket name
 */
export function setBucketName(name: string) {
  bucketName = name;
  log(`Object storage bucket set to: ${bucketName}`, 'storage');
}

/**
 * Get the bucket name
 * @returns The current bucket name
 */
export function getBucketName(): string | null {
  return bucketName;
}

/**
 * Create a new bucket if it doesn't exist
 * @param name The bucket name
 * @returns Promise resolving to the bucket
 */
export async function createBucketIfNotExists(name: string): Promise<any> {
  try {
    // Check if the bucket exists
    const [buckets] = await storage.getBuckets();
    const bucketExists = buckets.some(bucket => bucket.name === name);
    
    if (!bucketExists) {
      // Create the bucket if it doesn't exist
      log(`Creating new bucket: ${name}`, 'storage');
      const [bucket] = await storage.createBucket(name);
      setBucketName(name);
      return bucket;
    } else {
      log(`Using existing bucket: ${name}`, 'storage');
      setBucketName(name);
      return storage.bucket(name);
    }
  } catch (error) {
    log(`Error creating/accessing bucket: ${error instanceof Error ? error.message : 'Unknown error'}`, 'storage');
    throw error;
  }
}

/**
 * Upload a file to the bucket
 * @param filePath Local file path
 * @param destFileName Destination file name in the bucket
 * @returns Public URL to access the file
 */
export async function uploadFile(filePath: string, destFileName: string): Promise<string> {
  if (!bucketName) {
    throw new Error("Bucket name not set. Call setBucketName first.");
  }

  try {
    const bucket = storage.bucket(bucketName);
    
    // Check if the file exists locally
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local file not found: ${filePath}`);
    }

    // Upload the file to the bucket
    log(`Uploading file ${filePath} to bucket ${bucketName} as ${destFileName}`, 'storage');
    await bucket.upload(filePath, {
      destination: destFileName,
      // Make the file publicly accessible
      metadata: {
        cacheControl: 'public, max-age=31536000',
      },
    });

    // Make the file publicly accessible
    await bucket.file(destFileName).makePublic();

    // Get the public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${destFileName}`;
    log(`File uploaded successfully. Public URL: ${publicUrl}`, 'storage');
    
    return publicUrl;
  } catch (error) {
    log(`Error uploading file: ${error instanceof Error ? error.message : 'Unknown error'}`, 'storage');
    throw error;
  }
}

/**
 * Get a temporary signed URL for a file (for secure access)
 * @param fileName The name of the file in the bucket
 * @param expires Expiration time in minutes (default: 15)
 * @returns Signed URL for temporary access
 */
export async function getSignedUrl(fileName: string, expires: number = 15): Promise<string> {
  if (!bucketName) {
    throw new Error("Bucket name not set. Call setBucketName first.");
  }

  try {
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);

    // Generate a signed URL that expires after specified minutes
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expires * 60 * 1000,
    });

    log(`Generated signed URL for ${fileName} (expires in ${expires} minutes)`, 'storage');
    return url;
  } catch (error) {
    log(`Error generating signed URL: ${error instanceof Error ? error.message : 'Unknown error'}`, 'storage');
    throw error;
  }
}

/**
 * Delete a file from the bucket
 * @param fileName The name of the file to delete
 */
export async function deleteFile(fileName: string): Promise<void> {
  if (!bucketName) {
    throw new Error("Bucket name not set. Call setBucketName first.");
  }

  try {
    const bucket = storage.bucket(bucketName);
    await bucket.file(fileName).delete();
    log(`Deleted file ${fileName} from bucket ${bucketName}`, 'storage');
  } catch (error) {
    log(`Error deleting file: ${error instanceof Error ? error.message : 'Unknown error'}`, 'storage');
    throw error;
  }
}

/**
 * List all files in the bucket
 * @returns Array of file names
 */
export async function listFiles(): Promise<string[]> {
  if (!bucketName) {
    throw new Error("Bucket name not set. Call setBucketName first.");
  }

  try {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles();
    
    return files.map(file => file.name);
  } catch (error) {
    log(`Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`, 'storage');
    throw error;
  }
}