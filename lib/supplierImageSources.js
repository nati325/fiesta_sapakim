const BAD_ENGAGED_PATTERNS = [
  /\/deals\/1088\//i,
  /\/deals\/1301\/images\/resize\/בזום_שלך_62_large/i,
];

export function isBadEngagedImage(url) {
  if (!url) return false;
  const value = String(url);
  if (!value.includes('engaged.co.il')) return false;
  return BAD_ENGAGED_PATTERNS.some((pattern) => pattern.test(value));
}

export function isGoogleOrSocialImage(url) {
  if (!url || !String(url).startsWith('http')) return false;
  const value = String(url);
  if (isBadEngagedImage(value)) return false;
  if (/googleusercontent\.com|ggpht\.com|gstatic\.com|google\.com\/maps/i.test(value)) return true;
  if (/instagram\.com|cdninstagram\.com|fbcdn\.net/i.test(value)) return true;
  if (value.includes('engaged.co.il')) return false;
  return true;
}

export function collectLocalMedia(supplier) {
  if (!supplier) return [];
  const paths = [];
  for (const item of supplier.portfolio || []) {
    if (String(item).startsWith('/media/')) paths.push(item);
  }
  for (const item of supplier.images || []) {
    if (String(item).startsWith('/media/')) paths.push(item);
  }
  return [...new Set(paths)];
}

export function getGoogleImageUrl(supplier) {
  if (!supplier) return null;
  const value = supplier.google_image || supplier['Google Image'] || '';
  if (String(value).startsWith('http') && !isBadEngagedImage(value)) return value;
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

export function pickBestStoredImage(supplier) {
  if (!supplier) return null;

  const localMedia = collectLocalMedia(supplier);
  if (localMedia.length) return localMedia[0];

  const googleImage = getGoogleImageUrl(supplier);
  if (googleImage) return googleImage;

  for (const item of supplier.images || []) {
    if (isGoogleOrSocialImage(item)) return item;
  }

  const mainImage = supplier['Main Image'];
  if (isGoogleOrSocialImage(mainImage)) return mainImage;

  for (const item of supplier.images || []) {
    const value = String(item || '');
    if (value.startsWith('http') && !isBadEngagedImage(value)) return value;
  }

  return null;
}

export function supplierHasDisplayImage(supplier) {
  return !!pickBestStoredImage(supplier);
}

export function reorderSupplierImages(supplier) {
  if (!supplier) return supplier;

  const localMedia = collectLocalMedia(supplier);
  const googleImage = getGoogleImageUrl(supplier);
  const socialHttp = (supplier.images || []).filter((item) => isGoogleOrSocialImage(item));
  const otherHttp = (supplier.images || []).filter((item) => {
    const value = String(item || '');
    return value.startsWith('http') && !isBadEngagedImage(value) && !socialHttp.includes(item);
  });
  const nonHttp = (supplier.images || []).filter((item) => !String(item).startsWith('http') && !localMedia.includes(item));

  const images = [...new Set([...localMedia, ...socialHttp, ...(googleImage ? [googleImage] : []), ...otherHttp, ...nonHttp])];
  const best = pickBestStoredImage({ ...supplier, images });

  return {
    ...supplier,
    images,
    'Main Image': best || supplier['Main Image'] || '',
    ...(googleImage ? { google_image: googleImage, 'Google Image': googleImage } : {}),
  };
}
