import fs from 'fs';
import path from 'path';
import { isLikelyBadgeDimensions, isBadImageUrl } from './supplierImageSources.js';

const MIN_LOCAL_BYTES = 12_000;

function localPathToDisk(relativePath, cwd = process.cwd()) {
  if (!relativePath || !String(relativePath).startsWith('/media/')) return null;
  return path.join(cwd, 'public', String(relativePath).replace(/^\//, ''));
}

/** Read JPEG/PNG dimensions from file header (no deps). */
export function readImageDimensions(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = Buffer.alloc(64);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);

    if (buf[0] === 0x89 && buf[1] === 0x50) {
      const full = fs.readFileSync(filePath);
      if (full.length < 24) return null;
      return { width: full.readUInt32BE(16), height: full.readUInt32BE(20) };
    }

    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const full = fs.readFileSync(filePath);
      let i = 2;
      while (i < full.length - 9) {
        if (full[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = full[i + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          return {
            height: full.readUInt16BE(i + 5),
            width: full.readUInt16BE(i + 7),
          };
        }
        if (marker === 0xd9 || marker === 0xda) break;
        const len = full.readUInt16BE(i + 2);
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function scoreLocalMediaPath(relativePath, cwd = process.cwd()) {
  if (isBadImageUrl(relativePath)) return -1;
  const disk = localPathToDisk(relativePath, cwd);

  // Vercel serverless often can't stat `public/` files even though CDN serves them.
  if (!disk || !fs.existsSync(disk)) {
    if (process.env.VERCEL || process.env.FIESTA_TRUST_MEDIA_PATHS === '1') {
      return 10_000;
    }
    return -1;
  }

  let size = 0;
  try {
    size = fs.statSync(disk).size;
  } catch {
    return -1;
  }

  // Keep a soft floor, but don't drop real Easy thumbs (~5KB) entirely on disk.
  if (size < 3_000) return -1;

  const dims = readImageDimensions(disk);
  if (dims && isLikelyBadgeDimensions(dims.width, dims.height)) return -1;

  let score = size;
  if (dims) {
    score += Math.min(dims.width, dims.height) * 50;
    if (dims.height >= 200 && dims.width >= 200) score += 50_000;
  }
  return score;
}

/** Prefer real photos over App Store badges stored as img_1.jpg */
export function rankLocalMedia(paths, cwd = process.cwd()) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  return unique
    .map((p) => ({ path: p, score: scoreLocalMediaPath(p, cwd) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.path);
}

/**
 * Reorder supplier.images so the best local photo is first,
 * and set preferredImage for the client picker.
 */
export function applyPreferredLocalImage(supplier, cwd = process.cwd()) {
  if (!supplier) return supplier;

  const localPaths = [];
  for (const item of supplier.portfolio || []) {
    if (String(item).startsWith('/media/')) localPaths.push(item);
  }
  for (const item of supplier.images || []) {
    if (String(item).startsWith('/media/')) localPaths.push(item);
  }

  const ranked = rankLocalMedia([...new Set(localPaths)], cwd);
  if (!ranked.length) {
    return {
      ...supplier,
      preferredImage: '',
    };
  }

  const rest = (supplier.images || []).filter((img) => !ranked.includes(img));
  return {
    ...supplier,
    preferredImage: ranked[0],
    images: [...ranked, ...rest],
    'Main Image': ranked[0],
  };
}
