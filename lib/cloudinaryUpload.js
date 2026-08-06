/**
 * Cloudinary is retired. All published vendor files go through lib/imageStore.js
 * into the shared Fiesta MongoDB (`fiesta.images`) and are served from
 * /api/image/<hash>. Scraping keeps path/URL references only.
 */

export function isCloudinaryConfigured() {
  return false;
}

export async function uploadBufferToCloudinary() {
  throw new Error(
    'Cloudinary בוטל. השתמשו ב-putImage / ingestImage (מונגו fiesta.images).'
  );
}

export async function uploadToCloudinary() {
  return uploadBufferToCloudinary();
}

export async function uploadRemoteImageToCloudinary() {
  return uploadBufferToCloudinary();
}

export async function ensureCloudUrl(url) {
  return url || '';
}
