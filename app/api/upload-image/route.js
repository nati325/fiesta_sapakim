/**
 * Upload an image/file into the Fiesta Mongo `images` collection.
 * Multipart keeps large phone photos out of the JSON push body (Vercel 413).
 */
import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { putImage, contentTypeFromName, MAX_IMAGE_BYTES } from '../../../lib/imageStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let fiestaClient = null;

function cleanMongoUri(raw) {
  let uri = String(raw || '').trim();
  if (
    (uri.startsWith('"') && uri.endsWith('"')) ||
    (uri.startsWith("'") && uri.endsWith("'"))
  ) {
    uri = uri.slice(1, -1).trim();
  }
  return uri;
}

async function getFiestaDb() {
  const uri = cleanMongoUri(process.env.FIESTA_MONGODB_URI);
  if (!uri) throw new Error('FIESTA_MONGODB_URI לא מוגדר');
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('FIESTA_MONGODB_URI לא תקין');
  }
  if (!fiestaClient) {
    fiestaClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    await fiestaClient.connect();
  }
  return fiestaClient.db('fiesta');
}

const ALLOWED = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'pdf',
]);

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') || formData.get('image');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'לא נבחר קובץ' }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `הקובץ גדול מדי (מקסימום ${MAX_IMAGE_BYTES / 1048576}MB). נסו לצלם מחדש או לדחוס.` },
        { status: 400 }
      );
    }

    const ext = (file.name?.split('.').pop() || '').toLowerCase();
    const okExt = ALLOWED.has(ext) || String(file.type || '').startsWith('image/');
    if (!okExt) {
      return NextResponse.json({ error: 'סוג קובץ לא נתמך. נסו JPG או PNG' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name?.includes('.') ? file.name : `upload.${ext || 'jpg'}`;
    const db = await getFiestaDb();
    const stored = await putImage(db, buffer, {
      contentType: file.type || contentTypeFromName(fileName),
      fileName,
    });

    return NextResponse.json({ url: stored.url, hash: stored.hash, size: stored.size });
  } catch (error) {
    console.error('upload-image error:', error);
    return NextResponse.json(
      { error: error?.message || 'העלאה נכשלה' },
      { status: 500 }
    );
  }
}
