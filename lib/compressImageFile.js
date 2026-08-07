/**
 * Compress/resize an image in the browser before upload.
 * Phone photos are often 5–12MB and fail on serverless hosts (Vercel 413);
 * this keeps them under ~1MB.
 *
 * Copied to stay in sync with Fiesta/fiesta-nextjs/lib/compressImageFile.js
 */
export async function compressImageFile(file, { maxEdge = 1600, quality = 0.82, maxBytes = 900_000 } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;
  if (file.size <= maxBytes && file.type === 'image/jpeg') return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC / unsupported decode — send original and let the server try
    return file;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let q = quality;
    let blob = await canvasToBlob(canvas, 'image/jpeg', q);
    while (blob && blob.size > maxBytes && q > 0.45) {
      q -= 0.1;
      blob = await canvasToBlob(canvas, 'image/jpeg', q);
    }

    if (!blob) return file;

    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close?.();
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}
