/**
 * cloudinaryUpload.js
 * Uploads local supplier images to Cloudinary and returns a permanent CDN URL.
 * Used during the push-to-fiesta flow to replace local /media/... paths with cloud URLs.
 */
import fs from 'fs';
import path from 'path';

let cloudinary = null;
let configured = false;

async function getCloudinary() {
  if (!cloudinary) {
    const mod = await import('cloudinary');
    cloudinary = mod.v2;
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    configured = true;
  }
  return cloudinary;
}

/**
 * Uploads a local image file to Cloudinary.
 *
 * @param {string} localRelativePath  e.g. /media/suppliers/052-3300403/img_1.jpg
 * @returns {Promise<string|null>}    Cloudinary https URL, or null on failure
 */
async function uploadToCloudinary(source, options = {}) {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    console.warn('[Cloudinary] credentials not configured — skipping upload');
    return null;
  }

  const cld = await getCloudinary();

  try {
    const result = await cld.uploader.upload(source, {
      overwrite: false,
      resource_type: 'image',
      ...options,
    });
    console.log(`[Cloudinary] ✅ Uploaded: ${result.secure_url}`);
    return result.secure_url;
  } catch (err) {
    console.error(`[Cloudinary] ❌ Upload failed: ${err.message}`);
    return null;
  }
}

export async function uploadRemoteImageToCloudinary(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('http')) return null;
  return uploadToCloudinary(imageUrl);
}

/**
 * Upload a browser data-URI (e.g. contract screenshot / extra gallery photo).
 * Avoids storing huge base64 blobs in MongoDB.
 */
export async function uploadDataUriToCloudinary(dataUri, options = {}) {
  if (!dataUri || !String(dataUri).startsWith('data:image/')) return null;
  const stamp = Date.now().toString(36);
  const publicId =
    options.public_id ||
    `fiesta-uploads/${options.folder || 'gallery'}/${options.name || stamp}`;
  return uploadToCloudinary(dataUri, {
    public_id: publicId,
    folder: undefined,
    overwrite: true,
  });
}

export async function uploadLocalImageToCloudinary(localRelativePath) {
  if (!localRelativePath || !localRelativePath.startsWith('/media/')) return null;

  const localFilePath = path.join(process.cwd(), 'public', localRelativePath.replace(/^\//, ''));
  if (!fs.existsSync(localFilePath)) return null;

  const parts = localRelativePath.split('/').filter(Boolean);
  const folder = parts[parts.length - 2] || 'suppliers';
  const fileName = path.basename(localRelativePath, path.extname(localRelativePath));
  const publicId = `fiesta-suppliers/${folder}/${fileName}`;

  return uploadToCloudinary(localFilePath, { public_id: publicId });
}

/**
 * Takes any image path/URL and ensures it ends up as a public https URL.
 * - Already https → returned as-is
 * - Local /media/... path → uploaded to Cloudinary → returns CDN URL
 * - File doesn't exist locally → returns null
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export async function ensureCloudUrl(url, origin = '') {
  if (!url) return null;
  if (url.startsWith('https://') || url.startsWith('http://')) return url;

  const localUrl = await uploadLocalImageToCloudinary(url);
  if (localUrl) return localUrl;

  if (url.startsWith('/media/')) {
    const base =
      process.env.SCRAPING_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      origin ||
      '';
    if (base) {
      const remoteUrl = `${base.replace(/\/$/, '')}${url}`;
      return uploadRemoteImageToCloudinary(remoteUrl);
    }
  }

  return null;
}
