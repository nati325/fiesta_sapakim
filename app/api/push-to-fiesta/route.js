import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { buildDefaultFiestaData, pushSupplierToFiesta } from '../../../lib/fiestaPushCore';

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
  if (!uri) throw new Error('FIESTA_MONGODB_URI לא מוגדר ב-.env.local');
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error(
      'FIESTA_MONGODB_URI לא תקין (חייב להתחיל ב-mongodb:// או mongodb+srv://). בדוק שאין מרכאות מיותרות ב-Vercel/.env'
    );
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

export async function DELETE(req) {
  try {
    const { contact, name } = await req.json();
    const db = await getFiestaDb();
    const vendors = db.collection('vendors');
    const or = [];
    if (contact) {
      const digits = contact.replace(/\D/g, '');
      const pattern = digits.split('').join('[^0-9]*');
      or.push({ contact: { $regex: pattern } });
    }
    if (name) or.push({ name: { $regex: `^${name}$`, $options: 'i' } });
    if (!or.length) return NextResponse.json({ error: 'contact or name required' }, { status: 400 });
    const matches = await vendors.find({ $or: or }).project({ name: 1, contact: 1, type: 1 }).toArray();
    if (!matches.length) return NextResponse.json({ deleted: 0, matches: [] });
    const result = await vendors.deleteMany({ _id: { $in: matches.map((m) => m._id) } });
    return NextResponse.json({ deleted: result.deletedCount, matches });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getFiestaDb();
    const vendors = db.collection('vendors');
    const total = await vendors.countDocuments({});
    const djCount = await vendors.countDocuments({ type: 'dj' });
    const djs = await vendors
      .find({ type: 'dj' })
      .project({ name: 1, contact: 1, eventTypes: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .toArray();
    return NextResponse.json({ total, djCount, djs });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { supplier, fiestaData } = await req.json();

    const origin =
      req.headers.get('origin') ||
      process.env.SCRAPING_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      '';

    const db = await getFiestaDb();
    const vendors = db.collection('vendors');

    const merged = buildDefaultFiestaData(supplier, fiestaData || {});
    const result = await pushSupplierToFiesta({
      vendorsCollection: vendors,
      supplier,
      fiestaData: merged,
      origin,
      updateIfExists: true,
      db,
    });

    const vendorId = result.vendorId?.toString?.() || result.vendorId;

    if (result.status === 'updated') {
      return NextResponse.json({
        success: true,
        updated: true,
        vendorId,
        name: result.name,
      });
    }

    if (result.status === 'exists') {
      return NextResponse.json({ exists: true, vendorId });
    }

    return NextResponse.json({
      success: true,
      vendorId,
      name: result.name,
    });
  } catch (error) {
    console.error('Push to Fiesta MongoDB error:', error);
    const message = error?.message || 'שגיאה בשליחה לפייסטה';
    const hint =
      /expected pattern|Invalid URL|Invalid scheme|unescaped/i.test(message)
        ? ' — בדקו FIESTA_MONGODB_URI וכתובות תמונות (URL לא תקין)'
        : '';
    return NextResponse.json(
      { error: `${message}${hint}`, errorName: error?.name || 'Error' },
      { status: 500 }
    );
  }
}
