/**
 * Content-addressed binary store for vendor images and documents, kept inside
 * MongoDB instead of a third-party CDN.
 *
 * IDENTICAL COPY. This file lives in both `Fiesta/fiesta-nextjs/lib/imageStore.js`
 * and `fiesta_sapakim/lib/imageStore.js`. The two apps deploy separately and
 * share no package, so the copies must stay byte-for-byte equal.
 *
 * A file's id is the SHA-256 of its bytes. Two consequences follow, and both are
 * the point of the design: the same picture uploaded twice is stored once, and a
 * URL can never go stale, because different bytes always produce a different
 * URL. That is what makes it safe to serve these with a one-year immutable
 * cache header — which in turn is what keeps a free-tier cluster viable, since
 * the CDN absorbs the reads and Mongo is touched about once per file per edge.
 *
 * Files go in one document each rather than GridFS: everything here is far under
 * the 16 MB BSON ceiling, and MongoDB's own guidance is to prefer a single
 * document with a binary field in that case.
 *
 * Soft storage cap: Atlas M0 is 512 MB total. We stop accepting new image bytes
 * around 350 MB so vendors/indexes still fit.
 */

import { createHash } from 'node:crypto';

export const IMAGES_COLLECTION = 'images';

/** Below the 16 MB BSON document ceiling with room for metadata. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Videos/agreements above this are refused so free-tier storage lasts. */
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024;

/** Leave headroom under the 512 MB Atlas M0 ceiling. */
export const SOFT_STORAGE_LIMIT_BYTES = 350 * 1024 * 1024;

const CONTENT_TYPE_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heic',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** Served inline; anything else is sent as an attachment. */
const INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/svg+xml',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

export function contentTypeFromName(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || '';
}

export function isInlineContentType(contentType) {
  return INLINE_TYPES.has(String(contentType || '').toLowerCase());
}

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function imageUrlForHash(hash) {
  return `/api/image/${hash}`;
}

/** True for a URL this module produced, so callers can skip re-storing it. */
export function isStoredImageUrl(url) {
  return /^\/api\/image\/[a-f0-9]{64}$/.test(String(url || '').trim());
}

export function hashFromStoredUrl(url) {
  const match = String(url || '').trim().match(/^\/api\/image\/([a-f0-9]{64})$/);
  return match ? match[1] : '';
}

/** Sum of `size` fields on the images collection (approx bytes used). */
export async function imagesCollectionBytes(db) {
  if (!db) return 0;
  const rows = await db
    .collection(IMAGES_COLLECTION)
    .aggregate([{ $group: { _id: null, total: { $sum: '$size' } } }])
    .toArray();
  return Number(rows[0]?.total) || 0;
}

/**
 * Writes the bytes if they are not already there and returns the stable URL.
 * `db` is a driver Db handle — `mongoose.connection.db` works, so does
 * `client.db('fiesta')`.
 */
export async function putImage(db, buffer, { contentType = '', fileName = '' } = {}) {
  if (!db) throw new Error('putImage: חסר חיבור למסד');
  if (!buffer?.length) throw new Error('putImage: קובץ ריק');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `הקובץ גדול מדי (${(buffer.length / 1048576).toFixed(1)}MB, המקסימום ${MAX_IMAGE_BYTES / 1048576}MB)`
    );
  }

  const resolvedType = contentType || contentTypeFromName(fileName) || 'application/octet-stream';
  if (/^video\//i.test(resolvedType) && buffer.length > MAX_VIDEO_BYTES) {
    throw new Error(
      `קובץ וידאו גדול מדי (${(buffer.length / 1048576).toFixed(1)}MB, המקסימום ${MAX_VIDEO_BYTES / 1048576}MB)`
    );
  }

  const hash = hashBuffer(buffer);

  const existing = await db
    .collection(IMAGES_COLLECTION)
    .findOne({ _id: hash }, { projection: { _id: 1 } });

  if (!existing) {
    const used = await imagesCollectionBytes(db);
    if (used + buffer.length > SOFT_STORAGE_LIMIT_BYTES) {
      throw new Error(
        `אין מקום מספיק באחסון התמונות (${(used / 1048576).toFixed(0)}MB בשימוש, תקרה ${(SOFT_STORAGE_LIMIT_BYTES / 1048576).toFixed(0)}MB)`
      );
    }

    await db.collection(IMAGES_COLLECTION).insertOne({
      _id: hash,
      data: buffer,
      contentType: resolvedType,
      fileName: String(fileName || '').slice(0, 200),
      size: buffer.length,
      createdAt: new Date(),
    });
  }

  return {
    url: imageUrlForHash(hash),
    hash,
    size: buffer.length,
    contentType: resolvedType,
    deduped: Boolean(existing),
  };
}

/** Returns `{ data: Buffer, contentType, fileName, size }` or null. */
export async function getImage(db, hash) {
  if (!db || !/^[a-f0-9]{64}$/.test(String(hash || ''))) return null;

  const doc = await db.collection(IMAGES_COLLECTION).findOne({ _id: hash });
  if (!doc?.data) return null;

  // The driver hands back BSON Binary; older writes may already be a Buffer.
  const data = Buffer.isBuffer(doc.data)
    ? doc.data
    : Buffer.from(doc.data.buffer ?? doc.data);

  return {
    data,
    contentType: doc.contentType || 'application/octet-stream',
    fileName: doc.fileName || '',
    size: doc.size || data.length,
  };
}
