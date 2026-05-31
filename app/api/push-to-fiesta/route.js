import { NextResponse } from 'next/server';

import { MongoClient } from 'mongodb';

import { buildDefaultFiestaData, pushSupplierToFiesta } from '../../../lib/fiestaPushCore';



let fiestaClient = null;



async function getFiestaDb() {

  const uri = process.env.FIESTA_MONGODB_URI;

  if (!uri) throw new Error('FIESTA_MONGODB_URI לא מוגדר ב-.env.local');



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
    if (contact) or.push({ contact: { $regex: contact.replace(/\D/g, '') } });
    if (name) or.push({ name: { $regex: `^${name}$`, $options: 'i' } });
    if (!or.length) return NextResponse.json({ error: 'contact or name required' }, { status: 400 });
    const matches = await vendors.find({ $or: or }).project({ name: 1, contact: 1, type: 1 }).toArray();
    if (!matches.length) return NextResponse.json({ deleted: 0, matches: [] });
    const result = await vendors.deleteMany({ _id: { $in: matches.map(m => m._id) } });
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
    const djs = await vendors.find({ type: 'dj' })
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



    const result = await pushSupplierToFiesta({

      vendorsCollection: vendors,

      supplier,

      fiestaData: buildDefaultFiestaData(supplier, fiestaData || {}),

      origin,

    });



    if (result.status === 'exists') {
      const merged = buildDefaultFiestaData(supplier, fiestaData || {});
      if (merged.type) {
        await vendors.updateOne(
          { _id: result.vendorId },
          {
            $set: {
              type: merged.type,
              description: merged.description || supplier.description || '',
              region: merged.region || '',
              agreementSigned: merged.agreementSigned ?? true,
              contact: supplier['Real Phone'] || supplier.phone || '',
            },
          }
        );
        return NextResponse.json({ updated: true, exists: true });
      }
      return NextResponse.json({ exists: true });
    }



    return NextResponse.json({ success: true });

  } catch (error) {

    console.error('Push to Fiesta MongoDB error:', error);

    return NextResponse.json({ error: error.message || 'שגיאה בשליחה לפייסטה' }, { status: 500 });

  }

}

