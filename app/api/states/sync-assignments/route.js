import { NextResponse } from 'next/server';
import getMongoClient from '../../../../lib/mongodb';
import { phoneKey } from '../../../../lib/phoneUtils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  try {
    const { assignments = [] } = await req.json();
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return NextResponse.json({ success: true, synced: 0 });
    }

    const client = await getMongoClient();
    const collection = client.db('fiesta_crm').collection('supplier_states');
    const now = new Date().toISOString();

    const byKey = new Map();
    for (const item of assignments) {
      const key = phoneKey(item?.phone);
      if (!key) continue;
      byKey.set(key, item);
    }

    const ops = [...byKey.entries()].map(([key, item]) => ({
      updateOne: {
        filter: { phone: key },
        update: {
          $set: {
            phone: key,
            phoneKey: key,
            assignedAgent: item.assignedAgent || '',
            assignedCategory: item.assignedCategory || '',
            moranGroup: item.moranGroup || '',
            supplierName: item.supplierName || '',
          },
          $setOnInsert: {
            assignedAt: now,
          },
        },
        upsert: true,
      },
    }));

    if (ops.length === 0) {
      return NextResponse.json({ success: true, synced: 0 });
    }

    const result = await collection.bulkWrite(ops, { ordered: false });
    return NextResponse.json({
      success: true,
      synced: ops.length,
      upserted: result.upsertedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('sync-assignments error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
