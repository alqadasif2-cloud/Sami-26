import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const UPLOADS_DIR = path.resolve('data', 'uploads');
const METADATA_FILE = path.resolve('data', 'uploads_metadata.json');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export interface StoredFileMetadata {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType?: string;
  storagePath: string;
  uploaderId: number;
  receiverId?: number;
  participantIds?: number[];
  channelId?: string;
  folder: string;
  metadata?: any;
  createdAt: number;
}

function loadMetadata(): Record<string, StoredFileMetadata> {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveMetadata(data: Record<string, StoredFileMetadata>): void {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

export async function saveFile(
  fileName: string,
  buffer: Buffer,
  mimeType: string,
  uploaderId: number,
  folder = 'chat_files',
  metadata?: {
    channelId?: string;
    receiverId?: number;
    participantIds?: number[];
    [key: string]: any;
  }
): Promise<{
  fileUrl: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  storagePath: string;
  isCloudStorage: boolean;
}> {
  const hash = crypto.randomBytes(8).toString('hex');
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileId = `${folder}_${Date.now()}_${hash}`;
  const diskFileName = `${fileId}_${safeName}`;
  const filePath = path.join(UPLOADS_DIR, diskFileName);

  await fs.promises.writeFile(filePath, buffer);

  const fileRecord: StoredFileMetadata = {
    id: fileId,
    fileName: safeName,
    fileSize: buffer.length,
    mimeType: mimeType || 'application/octet-stream',
    fileType: mimeType || 'application/octet-stream',
    storagePath: `${folder}/${diskFileName}`,
    uploaderId,
    receiverId: metadata?.receiverId,
    participantIds: metadata?.participantIds,
    channelId: metadata?.channelId,
    folder,
    metadata,
    createdAt: Date.now(),
  };

  const allMeta = loadMetadata();
  allMeta[fileId] = fileRecord;
  saveMetadata(allMeta);

  return {
    fileUrl: `/api/files/${fileId}`,
    fileName: safeName,
    fileSize: buffer.length,
    fileType: mimeType,
    storagePath: fileRecord.storagePath,
    isCloudStorage: false,
  };
}

export async function getFile(fileId: string): Promise<{
  file: StoredFileMetadata;
  buffer: Buffer;
  data: Buffer;
} | null> {
  const allMeta = loadMetadata();
  const meta = allMeta[fileId];

  if (meta) {
    const diskFileName = path.basename(meta.storagePath);
    const filePath = path.join(UPLOADS_DIR, diskFileName);
    if (fs.existsSync(filePath)) {
      const buffer = await fs.promises.readFile(filePath);
      return {
        file: meta,
        buffer,
        data: buffer,
      };
    }
  }

  try {
    const files = await fs.promises.readdir(UPLOADS_DIR);
    const matched = files.find((f) => f.startsWith(fileId));
    if (matched) {
      const filePath = path.join(UPLOADS_DIR, matched);
      const buffer = await fs.promises.readFile(filePath);
      const fallbackMeta: StoredFileMetadata = {
        id: fileId,
        fileName: matched,
        fileSize: buffer.length,
        mimeType: 'application/octet-stream',
        fileType: 'application/octet-stream',
        storagePath: `${fileId}/${matched}`,
        uploaderId: 0,
        folder: 'chat_files',
        createdAt: Date.now(),
      };
      return {
        file: fallbackMeta,
        buffer,
        data: buffer,
      };
    }
  } catch {}

  return null;
}
