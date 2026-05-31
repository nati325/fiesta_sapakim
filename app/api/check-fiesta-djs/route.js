import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) return NextResponse.json({ error: 'FIESTA_MONGODB_URI missing' }, { status: 500 });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db('fiesta');
    const vendors = db.collection('vendors');

    const total = await vendors.countDocuments({});
    const djCount = await vendors.countDocuments({ type: 'dj' });
    const djs = await vendors.find({ type: 'dj' })
      .project({ name: 1, contact: 1, type: 1, eventTypes: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({ total, djCount, djs });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}
