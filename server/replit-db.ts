import fs from 'fs';
import { log } from './vite';
import Database from '@replit/database';

// Create a Replit database client
const db = new Database();

/**
 * Store a file in the Replit database
 * @param filePath Local path to the file
 * @param key Key to store the file under
 * @returns Promise resolving to true if successful
 */
export async function storeFile(filePath: string, key: string): Promise<boolean> {
  try {
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      log(`File not found: ${filePath}`, 'db');
      return false;
    }

    // Read the file as a buffer
    const fileBuffer = fs.readFileSync(filePath);
    
    // Convert buffer to base64 string for storage
    const base64Data = fileBuffer.toString('base64');
    
    // Store the file in the database
    await db.set(key, {
      data: base64Data,
      contentType: 'video/mp4',
      fileName: filePath.split('/').pop() || 'video.mp4',
      timestamp: Date.now()
    });
    
    log(`File stored successfully with key: ${key}`, 'db');
    return true;
  } catch (error) {
    log(`Error storing file: ${error instanceof Error ? error.message : 'Unknown error'}`, 'db');
    return false;
  }
}

/**
 * Get a file from the Replit database
 * @param key Key of the stored file
 * @returns Promise resolving to the file data or null if not found
 */
export async function getFile(key: string): Promise<{
  data: string;
  contentType: string;
  fileName: string;
  timestamp: number;
} | null> {
  try {
    const result = await db.get(key);
    // Check if we got a valid result
    if (!result || typeof result !== 'object') {
      log(`No file found with key: ${key}`, 'db');
      return null;
    }
    
    log(`Retrieved file with key: ${key}`, 'db');
    // Convert to the expected type with proper validation
    const fileData: any = result;
    
    if (
      !fileData.data || typeof fileData.data !== 'string' ||
      !fileData.contentType || typeof fileData.contentType !== 'string' ||
      !fileData.fileName || typeof fileData.fileName !== 'string' ||
      !fileData.timestamp || typeof fileData.timestamp !== 'number'
    ) {
      log(`Invalid file data format for key: ${key}`, 'db');
      return null;
    }
    
    return {
      data: fileData.data,
      contentType: fileData.contentType,
      fileName: fileData.fileName,
      timestamp: fileData.timestamp
    };
  } catch (error) {
    log(`Error retrieving file: ${error instanceof Error ? error.message : 'Unknown error'}`, 'db');
    return null;
  }
}

/**
 * List all stored files in the database
 * @returns Promise resolving to an array of keys
 */
export async function listFiles(): Promise<string[]> {
  try {
    const result = await db.list();
    // Ensure we have a valid result that's an array
    if (!result || !Array.isArray(result)) {
      log('Database returned invalid result for list operation', 'db');
      return [];
    }
    return result;
  } catch (error) {
    log(`Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`, 'db');
    return [];
  }
}

/**
 * Delete a file from the database
 * @param key Key of the file to delete
 * @returns Promise resolving to true if successful
 */
export async function deleteFile(key: string): Promise<boolean> {
  try {
    await db.delete(key);
    log(`Deleted file with key: ${key}`, 'db');
    return true;
  } catch (error) {
    log(`Error deleting file: ${error instanceof Error ? error.message : 'Unknown error'}`, 'db');
    return false;
  }
}