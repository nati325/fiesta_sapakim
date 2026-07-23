import fs from 'fs';
import path from 'path';
import { ensureCloudUrl, uploadDataUriToCloudinary } from './cloudinaryUpload.js';
import { isBadImageUrl, pickBestStoredImage } from './supplierImageSources.js';

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
 * 2. data:image → Cloudinary
 * 3. Local /media/... → Cloudinary, then local copy, then absolute dashboard URL
 */
export async function prepareFiestaImage(url, origin) {
  if (!url) return '';
  const value = String(url).trim();
  if (!value || value === 'N/A' || value === 'nan' || value === '[stored]') return '';
  if (isBadImageUrl(value) && !value.startsWith('data:')) return '';

  if (value.startsWith('http://') || value.startsWith('https://')) return value;

  if (value.startsWith('data:image/')) {
    const cloudUrl = await uploadDataUriToCloudinary(value, { folder: 'gallery' });
    return cloudUrl || '';
  }

  if (value.startsWith('/media/')) {
    const cloudUrl = await ensureCloudUrl(value, origin);
    if (cloudUrl) return cloudUrl;

    const localCopied = copyLocalImageToFiestaPublic(value);
    if (localCopied.startsWith('/images/vendors/')) return localCopied;

    const absolute = resolvePublicImageUrl(value, origin);
    if (absolute.startsWith('http')) return absolute;

    return '';
  }

  return resolvePublicImageUrl(value, origin);
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
  ).then((items) => items.filter(Boolean));
}

/** Prefer first selected gallery image; fall back to scraped ranking. */
export async function pickMainImage(supplier, origin, preferredList = null) {
  const ordered = [];
  if (Array.isArray(preferredList) && preferredList.length) {
    ordered.push(...preferredList);
  }
  const best = pickBestStoredImage(supplier);
  if (best) ordered.push(best);
  ordered.push(
    ...(supplier?.images || []),
    supplier?.['Main Image'],
    supplier?.['Google Image'],
    supplier?.google_image
  );

  const seen = new Set();
  for (const candidate of ordered) {
    const key = String(candidate || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const prepared = await prepareFiestaImage(key, origin);
    if (prepared) return prepared;
  }

  return '';
}

export async function prepareAgreementImage(agreementImage, origin) {
  if (!agreementImage || agreementImage === '[stored]') return '';
  if (String(agreementImage).startsWith('data:image/')) {
    const cloudUrl = await uploadDataUriToCloudinary(agreementImage, {
      folder: 'agreements',
      name: `agreement-${Date.now().toString(36)}`,
    });
    return cloudUrl || '';
  }
  return prepareFiestaImage(agreementImage, origin);
}
