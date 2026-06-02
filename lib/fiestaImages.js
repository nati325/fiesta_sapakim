import fs from 'fs';
import path from 'path';
import { ensureCloudUrl } from './cloudinaryUpload.js';

export function resolvePublicImageUrl(url, origin) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) {
    const base =
      process.env.SCRAPING_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      origin ||
      '';
    return base ? `${base.replace(/\/$/, '')}${url}` : url;
  }
  return url;
}

export function copyLocalImageToFiestaPublic(relativePath) {
  if (!relativePath || !relativePath.startsWith('/media/')) return relativePath;

  const fiestaImagesDir = process.env.FIESTA_PUBLIC_IMAGES_DIR;
  if (!fiestaImagesDir) return relativePath;

  const src = path.join(process.cwd(), 'public', relativePath.replace(/^\//, ''));
  if (!fs.existsSync(src)) return relativePath;

  const folder = path.basename(path.dirname(relativePath)).replace(/[^\w.-]/g, '_');
  const fileName = `${folder}_${path.basename(relativePath)}`;
  const dest = path.join(fiestaImagesDir, fileName);

  fs.mkdirSync(fiestaImagesDir, { recursive: true });
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }

  return `/images/vendors/${fileName}`;
}

/**
 * Prepares a single image URL for Fiesta:
 * 1. Already https → use as-is
 * 2. Local /media/... → try Cloudinary upload first, fallback to local copy
 * 3. Returns '' if image cannot be resolved
 */
export async function prepareFiestaImage(url, origin) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;

  if (url.startsWith('/media/')) {
    // Try Cloudinary (local file or remote fetch from this dashboard)
    const cloudUrl = await ensureCloudUrl(url, origin);
    if (cloudUrl) return cloudUrl;

    // Fallback: copy to Fiesta's local public folder (works for local dev)
    const localCopied = copyLocalImageToFiestaPublic(url);
    if (localCopied.startsWith('/images/vendors/')) return localCopied;

    // Last resort: full https URL on this dashboard — Fiesta can load it externally
    const absolute = resolvePublicImageUrl(url, origin);
    if (absolute.startsWith('http')) return absolute;

    return '';
  }

  return resolvePublicImageUrl(url, origin);
}

export async function toPortfolioItems(images, origin) {
  return Promise.all(
    (images || []).map(async (item, index) => {
      const raw = typeof item === 'string' ? item : item?.image;
      if (!raw) return null;
      const image = await prepareFiestaImage(raw, origin);
      if (!image) return null;
      return {
        title: typeof item === 'object' && item?.title ? item.title : `תמונה ${index + 1}`,
        image,
      };
    })
  ).then(items => items.filter(Boolean));
}

import { pickBestStoredImage } from './supplierImageSources.js';

export async function pickMainImage(supplier, origin) {
  const best = pickBestStoredImage(supplier);
  if (!best) return '';

  const prepared = await prepareFiestaImage(best, origin);
  if (prepared) return prepared;

  const fallbackCandidates = [
    ...(supplier?.images || []),
    supplier?.['Main Image'],
    supplier?.['Google Image'],
  ].filter(Boolean);

  for (const candidate of fallbackCandidates) {
    const preparedCandidate = await prepareFiestaImage(candidate, origin);
    if (preparedCandidate) return preparedCandidate;
  }

  return '';
}
