/**
 * Browser helpers: compress + upload images to Fiesta Mongo so the push JSON
 * never carries multi‑MB data URIs (Vercel returns 413 Function payload too large).
 */
import { compressImageFile } from './compressImageFile';

export function isStoredOrRemoteImageUrl(url) {
  const s = String(url || '').trim();
  if (!s || s === '[stored]') return false;
  return (
    s.startsWith('/api/image/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('/media/')
  );
}

async function dataUriToFile(dataUri, fileName = 'upload.jpg') {
  const res = await fetch(dataUri);
  const blob = await res.blob();
  const type = blob.type || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const base = fileName.replace(/\.[^.]+$/, '') || 'upload';
  return new File([blob], `${base}.${ext}`, { type });
}

/** POST multipart to /api/upload-image → `/api/image/<hash>`. */
export async function uploadImageFile(file) {
  if (!file) throw new Error('לא נבחר קובץ');
  const compressed = await compressImageFile(file);
  if (compressed.size > 3.5 * 1024 * 1024) {
    throw new Error('התמונה עדיין גדולה מדי אחרי דחיסה. נסו תמונה קטנה יותר או צילום מסך.');
  }
  const form = new FormData();
  form.append('file', compressed);
  const res = await fetch('/api/upload-image', { method: 'POST', body: form });
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      res.status === 413
        ? 'הקובץ גדול מדי לשרת (413). נסו תמונה קטנה יותר.'
        : `העלאה נכשלה (HTTP ${res.status})`
    );
  }
  if (!res.ok || !data.url) {
    throw new Error(data.error || `העלאה נכשלה (HTTP ${res.status})`);
  }
  return data.url;
}

/** Ensure value is a short URL — upload data URIs when needed. */
export async function ensureUploadedImageUrl(value, fileName = 'agreement.jpg') {
  const s = String(value || '').trim();
  if (!s || s === '[stored]') return '';
  if (isStoredOrRemoteImageUrl(s)) return s;
  if (s.startsWith('data:')) {
    const file = await dataUriToFile(s, fileName);
    return uploadImageFile(file);
  }
  return s;
}

/** Drop data URIs from a gallery; upload any that remain as data:. */
export async function sanitizeImageList(list, { max = 24 } = {}) {
  const out = [];
  for (const item of list || []) {
    if (out.length >= max) break;
    const raw = typeof item === 'string' ? item : item?.image;
    const s = String(raw || '').trim();
    if (!s) continue;
    if (isStoredOrRemoteImageUrl(s)) {
      out.push(s);
      continue;
    }
    if (s.startsWith('data:image/')) {
      try {
        out.push(await ensureUploadedImageUrl(s, `gallery-${out.length + 1}.jpg`));
      } catch (err) {
        console.warn('gallery image upload skipped:', err.message);
      }
    }
  }
  return out;
}

/** Keep only fields the push API needs — never the full CRM document. */
export function slimSupplierForPush(supplier) {
  if (!supplier) return {};
  const images = (supplier.images || [])
    .map((img) => (typeof img === 'string' ? img : img?.image))
    .filter((s) => isStoredOrRemoteImageUrl(s))
    .slice(0, 24);

  let reviews = [];
  if (Array.isArray(supplier.reviews)) reviews = supplier.reviews;
  else if (Array.isArray(supplier.reviews?.reviews)) reviews = supplier.reviews.reviews;
  reviews = reviews
    .filter((r) => r && typeof r === 'object')
    .slice(0, 30)
    .map((r) => ({
      reviewer: String(r.reviewer || r.author || '').slice(0, 120),
      rating: Number(r.rating) || 0,
      text: String(r.text || r.comment || '').slice(0, 800),
      source: String(r.source || '').slice(0, 40),
    }));

  return {
    'Supplier Name': supplier['Supplier Name'] || supplier.name || '',
    name: supplier.name || supplier['Supplier Name'] || '',
    'Real Phone': supplier['Real Phone'] || supplier.phone || '',
    phone: supplier.phone || supplier['Real Phone'] || '',
    Category: supplier.Category || supplier.category || '',
    category: supplier.category || supplier.Category || '',
    Address: supplier.Address || supplier.address || '',
    Website: supplier.Website || supplier.website || '',
    'Google Reviews Link': supplier['Google Reviews Link'] || supplier.google_reviews_link || '',
    'Google Rating': supplier['Google Rating'] || supplier.google_rating || '',
    'Reviews Count': supplier['Reviews Count'] || supplier.reviews_count || '',
    'Main Image': isStoredOrRemoteImageUrl(supplier['Main Image']) ? supplier['Main Image'] : '',
    'Google Image': isStoredOrRemoteImageUrl(supplier['Google Image'] || supplier.google_image)
      ? (supplier['Google Image'] || supplier.google_image)
      : '',
    description: String(supplier.description || '').slice(0, 4000),
    images,
    reviews,
  };
}
