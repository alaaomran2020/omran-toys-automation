import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Product image storage (disk + public serving).
 *
 * The store has no image storage endpoint usable server-side (its catalog
 * uses remote URLs), so the automation stores images on its own disk and
 * serves them at `GET /api/media/<file>` — the store receives a stable
 * public image URL.
 */

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export class MediaError extends Error {}

export interface SavedImage {
  path: string;
  url: string;
  filename: string;
}

const FILENAME_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpe?g|png|webp)$/i;

export class MediaService {
  private readonly dir: string;
  private readonly publicBaseUrl: string;

  constructor(storageDir: string, publicBaseUrl: string) {
    this.dir = resolve(storageDir);
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, '');
    mkdirSync(this.dir, { recursive: true });
  }

  get directory(): string {
    return this.dir;
  }

  saveImage(buffer: Buffer, mimeType: string, maxBytes: number): SavedImage {
    const extension = MIME_EXTENSIONS[mimeType];
    if (!extension) throw new MediaError(`unsupported image type: ${mimeType || 'unknown'}`);
    if (buffer.length === 0) throw new MediaError('empty image');
    if (buffer.length > maxBytes) throw new MediaError('image too large');
    const filename = `${randomUUID()}.${extension}`;
    const path = join(this.dir, filename);
    writeFileSync(path, buffer);
    return {
      path,
      url: `${this.publicBaseUrl}/api/media/${filename}`,
      filename,
    };
  }

  /** Read a stored image for public serving. Returns null when not found/invalid. */
  readImage(filename: string): { buffer: Buffer; mimeType: string } | null {
    if (typeof filename !== 'string' || !FILENAME_PATTERN.test(filename)) return null;
    const path = resolve(join(this.dir, filename));
    if (!path.startsWith(this.dir + sep)) return null;
    if (!existsSync(path)) return null;
    const extension = filename.split('.').pop()!.toLowerCase();
    const mimeType = EXTENSION_MIME[extension];
    if (!mimeType) return null;
    return { buffer: readFileSync(path), mimeType };
  }
}
