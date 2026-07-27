const BAD_ENGAGED_PATTERNS = [
  /\/deals\/1088\//i,
  /\/deals\/1301\/images\/resize\/בזום_שלך_62_large/i,
  /\/templates\/engaged\/images\//i,
  /logo-facebook/i,
];

/** URLs / paths that are badges, logos, store buttons — not real supplier photos */
const BAD_IMAGE_PATTERNS = [
  /app.?store/i,
  /play\.google/i,
  /play-badge/i,
  /google.?play/i,
  /badge/i,
  /mzstatic\.com/i,
  /applemediaservices/i,
  /linkmaker/i,
  /itunes\.apple/i,
  /apps\.apple\.com/i,
  /favicon/i,
  /sprite/i,
  /pixel/i,
  /emoji/i,
  /avatar/i,
  /logo_new/i,
  /[-_/]logo[-_./]/i,
  /[-_/]icon[-_./]/i,
  /wp-content\/uploads\/[^"' ]*logo/i,
  /download.?on.?the.?app.?store/i,
];

const MIN_PHOTO_HEIGHT = 120;
const MIN_PHOTO_WIDTH = 160;
const MAX_BADGE_ASPECT = 2.8;

export function isBadEngagedImage(url) {
  if (!url) return false;
  const value = String(url);
  if (!value.includes('engaged.co.il')) return false;
  return BAD_ENGAGED_PATTERNS.some((pattern) => pattern.test(value));
}

export function isBadImageUrl(url) {
  if (!url) return true;
  const value = String(url).trim();
  if (!value) return true;
  if (value.endsWith('.svg')) return true;
  if (isBadEngagedImage(value)) return true;
  if (BAD_IMAGE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  return false;
}

export function isLikelyBadgeDimensions(width, height) {
  if (!width || !height) return false;
  if (height < MIN_PHOTO_HEIGHT && width / height >= MAX_BADGE_ASPECT) return true;
  if (width < MIN_PHOTO_WIDTH && height < MIN_PHOTO_HEIGHT) return true;
  if (height <= 80 && width >= 100) return true;
  return false;
}

export function shouldRejectLoadedImage(width, height) {
  return isLikelyBadgeDimensions(width, height);
}

export function isGoogleOrSocialImage(url) {
  if (!url || !String(url).startsWith('http')) return false;
  const value = String(url);
  if (isBadImageUrl(value)) return false;
  if (/googleusercontent\.com|ggpht\.com|gstatic\.com|google\.com\/maps/i.test(value)) return true;
  if (/instagram\.com|cdninstagram\.com|fbcdn\.net/i.test(value)) return true;
  if (value.includes('engaged.co.il')) return false;
  return true;
}

export function collectLocalMedia(supplier) {
  if (!supplier) return [];
  const paths = [];
  for (const item of supplier.portfolio || []) {
    if (String(item).startsWith('/media/') && !isBadImageUrl(item)) paths.push(item);
  }
  for (const item of supplier.images || []) {
    if (String(item).startsWith('/media/') && !isBadImageUrl(item)) paths.push(item);
  }
  return [...new Set(paths)];
}

export function getGoogleImageUrl(supplier) {
  if (!supplier) return null;
  const value = supplier.google_image || supplier['Google Image'] || '';
  if (String(value).startsWith('http') && !isBadImageUrl(value)) return value;
  return null;
}

export function extractInstagramUrls(supplier) {
  if (!supplier) return [];
  const urls = new Set();

  const website = supplier.website || supplier.Website || '';
  if (String(website).startsWith('http') && /instagram\.com/i.test(website)) {
    urls.add(normalizeInstagramUrl(website));
  }

  for (const review of supplier.reviews || []) {
    const source = review?.source || '';
    if (!source.startsWith('http')) continue;

    if (/instagram\.com\/(p|reel)\//i.test(source)) {
      urls.add(source.split('?')[0]);
      continue;
    }

    const profileMatch = source.match(/https?:\/\/(?:www\.)?instagram\.com\/([^/?#]+)/i);
    if (profileMatch) {
      const handle = profileMatch[1].toLowerCase();
      if (!['p', 'reel', 'popular', 'explore', 'stories', 'accounts'].includes(handle)) {
        urls.add(`https://www.instagram.com/${profileMatch[1]}/`);
      }
    }
  }

  return [...urls].filter(Boolean);
}

function normalizeInstagramUrl(url) {
  const trimmed = String(url).split('?')[0].replace(/\/$/, '');
  if (/instagram\.com\/(p|reel)\//i.test(trimmed)) return trimmed;
  const profileMatch = trimmed.match(/instagram\.com\/([^/?#]+)/i);
  if (profileMatch && !['p', 'reel', 'popular', 'explore', 'stories'].includes(profileMatch[1].toLowerCase())) {
    return `https://www.instagram.com/${profileMatch[1]}/`;
  }
  return trimmed;
}

export function extractWebsiteUrl(supplier) {
  if (!supplier) return null;
  const website = supplier.website || supplier.Website || '';
  if (!String(website).startsWith('http')) return null;
  if (/instagram\.com/i.test(website)) return null;
  return website;
}

/**
 * Pick display image. Prefers preferredImage if set (server-ranked),
 * then first local /media/, then Google / social / http — skipping badges/logos.
 */
export function pickBestStoredImage(supplier) {
  if (!supplier) return null;

  if (supplier.preferredImage && !isBadImageUrl(supplier.preferredImage)) {
    return supplier.preferredImage;
  }

  const localMedia = collectLocalMedia(supplier);
  if (localMedia.length) return localMedia[0];

  const googleImage = getGoogleImageUrl(supplier);
  if (googleImage) return googleImage;

  for (const item of supplier.images || []) {
    if (isGoogleOrSocialImage(item)) return item;
  }

  const mainImage = supplier['Main Image'];
  if (isGoogleOrSocialImage(mainImage)) return mainImage;
  // Local dashboard media paths (served from /public on Vercel CDN)
  if (mainImage && String(mainImage).startsWith('/media/') && !isBadImageUrl(mainImage)) {
    return mainImage;
  }

  for (const item of supplier.images || []) {
    const value = String(item || '');
    if (value.startsWith('http') && !isBadImageUrl(value)) return value;
  }

  return null;
}

export function supplierHasDisplayImage(supplier) {
  return !!pickBestStoredImage(supplier);
}

export function reorderSupplierImages(supplier) {
  if (!supplier) return supplier;

  const preferred = supplier.preferredImage && !isBadImageUrl(supplier.preferredImage)
    ? [supplier.preferredImage]
    : [];
  const localMedia = collectLocalMedia(supplier).filter((p) => !preferred.includes(p));
  const googleImage = getGoogleImageUrl(supplier);
  const socialHttp = (supplier.images || []).filter((item) => isGoogleOrSocialImage(item));
  const otherHttp = (supplier.images || []).filter((item) => {
    const value = String(item || '');
    return value.startsWith('http') && !isBadImageUrl(value) && !socialHttp.includes(item);
  });
  const nonHttp = (supplier.images || []).filter(
    (item) => !String(item).startsWith('http') && !localMedia.includes(item) && !isBadImageUrl(item)
  );

  const images = [...new Set([...preferred, ...localMedia, ...socialHttp, ...(googleImage ? [googleImage] : []), ...otherHttp, ...nonHttp])];
  const best = pickBestStoredImage({ ...supplier, images, preferredImage: preferred[0] });

  return {
    ...supplier,
    images,
    preferredImage: best || preferred[0] || '',
    'Main Image': best || supplier['Main Image'] || '',
    ...(googleImage ? { google_image: googleImage, 'Google Image': googleImage } : {}),
  };
}

/** Next candidate after rejecting a loaded badge (client-side). */
export function getNextImageCandidate(supplier, currentUrl) {
  if (!supplier) return null;
  const candidates = [];
  if (supplier.preferredImage) candidates.push(supplier.preferredImage);
  candidates.push(...collectLocalMedia(supplier));
  const google = getGoogleImageUrl(supplier);
  if (google) candidates.push(google);
  for (const item of supplier.images || []) {
    const value = String(item || '');
    if (value.startsWith('http') && !isBadImageUrl(value)) candidates.push(value);
  }
  const unique = [...new Set(candidates.filter(Boolean))];
  const idx = unique.indexOf(currentUrl);
  if (idx >= 0 && idx < unique.length - 1) return unique[idx + 1];
  return unique.find((u) => u !== currentUrl) || null;
}
