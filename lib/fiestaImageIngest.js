import fs from 'fs';
import path from 'path';
import { putImage, isStoredImageUrl, MAX_IMAGE_BYTES, contentTypeFromName } from './imageStore.js';

/**
 * Turns whatever a scraped supplier hands us into bytes inside the Fiesta
 * database.
 *
 * The scraping side keeps images as plain references — a remote URL, a data URI
 * from the agent's phone, or a file the Python scrapers dropped under
 * `public/media/`. None of that costs storage, which matters because the CRM
 * tracks thousands of suppliers that may never be published. Bytes are only
 * materialised here, at push time, when a supplier actually goes live. Storage
 * therefore grows with the number of published vendors rather than the number
 * of scraped ones.
 *
 * A download that fails leaves the original URL in place: a hotlink that still
 * renders beats an empty image.
 */

const FETCH_TIMEOUT_MS = 15000;

function looksLikeImageType(contentType) {
  return /^(image|video)\//i.test(String(contentType || '')) ||
    /^application\/pdf$/i.test(String(contentType || ''));
}

async function bufferFromRemote(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Some hosts reject requests without a browser-ish agent.
      'User-Agent': 'Mozilla/5.0 (compatible; FiestaBot/1.0)',
      Accept: 'image/*,video/*,application/pdf;q=0.9,*/*;q=0.5',
    },
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const declared = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
  const declaredLength = Number(res.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(`גדול מדי (${(declaredLength / 1048576).toFixed(1)}MB)`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('תשובה ריקה');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`גדול מדי (${(buffer.length / 1048576).toFixed(1)}MB)`);
  }

  const fromName = contentTypeFromName(new URL(url).pathname);
  const contentType = looksLikeImageType(declared) ? declared : fromName;
  if (!contentType) throw new Error(`סוג תוכן לא נתמך (${declared || 'לא צוין'})`);

  return { buffer, contentType, fileName: path.basename(new URL(url).pathname) || 'image' };
}

function bufferFromDataUri(value) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!match) throw new Error('data URI לא תקין');

  const [, contentType, isBase64, payload] = match;
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');

  if (!buffer.length) throw new Error('data URI ריק');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`גדול מדי (${(buffer.length / 1048576).toFixed(1)}MB)`);
  }

  const ext = (contentType.split('/')[1] || 'jpg').replace(/[^\w]/g, '');
  return { buffer, contentType, fileName: `upload.${ext}` };
}

function bufferFromLocal(relativePath) {
  const clean = relativePath.split('?')[0];
  const abs = path.join(process.cwd(), 'public', clean.replace(/^\//, ''));
  if (!fs.existsSync(abs)) throw new Error('הקובץ לא קיים על הדיסק');

  const stat = fs.statSync(abs);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`גדול מדי (${(stat.size / 1048576).toFixed(1)}MB)`);
  }

  return {
    buffer: fs.readFileSync(abs),
    contentType: contentTypeFromName(abs) || 'application/octet-stream',
    fileName: path.basename(abs),
  };
}

/**
 * Stores `source` in the Fiesta database and returns `/api/image/<sha256>`.
 * Without a `db` handle, or when the bytes cannot be reached, the original
 * value is returned untouched.
 */
export async function ingestImage(source, { db, label = 'image' } = {}) {
  const value = String(source || '').trim();
  if (!value) return '';
  if (isStoredImageUrl(value)) return value;
  if (!db) return value;

  try {
    let extracted;
    if (value.startsWith('data:')) {
      extracted = bufferFromDataUri(value);
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
      extracted = await bufferFromRemote(value);
    } else if (value.startsWith('/')) {
      extracted = bufferFromLocal(value);
    } else {
      return value;
    }

    const stored = await putImage(db, extracted.buffer, {
      contentType: extracted.contentType,
      fileName: extracted.fileName,
    });
    return stored.url;
  } catch (error) {
    const shown = value.startsWith('data:') ? '[data URI]' : value.slice(0, 120);
    console.warn(`[images] ${label} לא נשמר במונגו (${error.message}): ${shown}`);
    // A data URI cannot survive as a URL, so there is nothing to fall back to.
    return value.startsWith('data:') ? '' : value;
  }
}
