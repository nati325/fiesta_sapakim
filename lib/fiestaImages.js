import fs from 'fs';
import path from 'path';
import { ingestImage } from './fiestaImageIngest.js';
import { isStoredImageUrl } from './imageStore.js';
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
 * Prepares a single image for Fiesta.
 *
 * Given a `db` handle on the Fiesta database, the bytes are pulled down and
 * stored there, and the returned value is a `/api/image/<sha256>` path. This is
 * the only moment in the pipeline where an image stops being a reference and
 * becomes a file we own.
 *
 * Without `db` — older scripts that only pass a vendors collection — the value
 * is passed through as before, so nothing breaks; it simply stays a reference.
 */
export async function prepareFiestaImage(url, origin, db) {
  if (!url) return '';
  const value = String(url).trim();
  if (!value || value === 'N/A' || value === 'nan' || value === '[stored]') return '';
  if (isBadImageUrl(value) && !value.startsWith('data:')) return '';
  if (isStoredImageUrl(value)) return value;

  if (db) {
    return ingestImage(value, { db, label: 'תמונת ספק', origin });
  }

  if (value.startsWith('http://') || value.startsWith('https://')) return value;

  // A data URI has no address to fall back on once we cannot store it.
  if (value.startsWith('data:image/')) return '';

  if (value.startsWith('/media/')) {
    const localCopied = copyLocalImageToFiestaPublic(value);
    if (localCopied.startsWith('/images/vendors/')) return localCopied;

    const absolute = resolvePublicImageUrl(value, origin);
    if (absolute.startsWith('http')) return absolute;

    return '';
  }

  return resolvePublicImageUrl(value, origin);
}

export async function toPortfolioItems(images, origin, db) {
  return Promise.all(
    (images || []).map(async (item, index) => {
      const raw = typeof item === 'string' ? item : item?.image;
      if (!raw) return null;
      const image = await prepareFiestaImage(raw, origin, db);
      if (!image) return null;
      return {
        title: typeof item === 'object' && item?.title ? item.title : `תמונה ${index + 1}`,
        image,
      };
    })
  ).then((items) => items.filter(Boolean));
}

/** Prefer first selected gallery image; fall back to scraped ranking. */
export async function pickMainImage(supplier, origin, preferredList = null, db = null) {
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
    const prepared = await prepareFiestaImage(key, origin, db);
    if (prepared) return prepared;
  }

  return '';
}

export async function prepareAgreementImage(agreementImage, origin, db) {
  if (!agreementImage || agreementImage === '[stored]') return '';
  const value = String(agreementImage).trim();
  if (isStoredImageUrl(value)) return value;

  if (value.startsWith('data:') && db) {
    return ingestImage(value, { db, label: 'הסכם', origin });
  }

  return prepareFiestaImage(value, origin, db);
}

/** Prepare up to 3 agreement images; empty slots are dropped. */
export async function prepareAgreementImages(list, origin, db) {
  const raw = (Array.isArray(list) ? list : list ? [list] : [])
    .map((v) => String(v || '').trim())
    .filter((v) => v && v !== '[stored]')
    .slice(0, 3);

  const out = [];
  for (const value of raw) {
    const prepared = await prepareAgreementImage(value, origin, db);
    if (prepared && !out.includes(prepared)) out.push(prepared);
  }
  return out;
}
