import fs from 'fs';
import path from 'path';

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

export function prepareFiestaImage(url, origin) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;

  const localCopied = copyLocalImageToFiestaPublic(url);
  if (localCopied.startsWith('/images/vendors/')) return localCopied;

  if (url.startsWith('/media/')) return '';
  return resolvePublicImageUrl(url, origin);
}

export function toPortfolioItems(images, origin) {
  return (images || [])
    .map((item, index) => {
      const raw = typeof item === 'string' ? item : item?.image;
      if (!raw) return null;
      const image = prepareFiestaImage(raw, origin);
      return {
        title: typeof item === 'object' && item?.title ? item.title : `תמונה ${index + 1}`,
        image,
      };
    })
    .filter(Boolean);
}

export function pickMainImage(supplier, origin) {
  const candidates = [
    supplier?.images?.[0],
    supplier?.['Main Image'],
    supplier?.['Google Image'],
  ].filter(Boolean);

  for (const candidate of candidates) {
    const prepared = prepareFiestaImage(candidate, origin);
    if (prepared) return prepared;
  }
  return '';
}
