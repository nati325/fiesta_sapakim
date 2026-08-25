import { NextResponse } from 'next/server';
import getMongoClient from '../../../../lib/mongodb';
import { invalidateStatesCache } from '../../../../lib/agentFeedQuery';
import { upsertSupplierState } from '../../../../lib/supplierStateMongo';
import { phoneKey } from '../../../../lib/phoneUtils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Background assign — called by the client after feed is already on screen. */
export async function POST(req) {
  try {
    const body = await req.json();
    const agent = body.agent || '';
    const items = Array.isArray(body.items) ? body.items : [];
    if (!agent || !items.length) {
      return NextResponse.json({ success: true, synced: 0 });
    }

    const client = await getMongoClient();
    const statesCollection = client.db('fiesta_crm').collection('supplier_states');

    let synced = 0;
    for (const item of items) {
      const key = phoneKey(item.phone);
      if (!key) continue;
      const existing = await statesCollection.findOne({ phone: key });
      if (existing?.photoOwner && existing.photoOwner !== agent) continue;
      await upsertSupplierState(
        statesCollection,
        key,
        {
          assignedAgent: agent,
          assignedCategory: item.assignedCategory || 'כללי',
          supplierName: item.supplierName || '',
        },
        {}
      );
      synced += 1;
    }

    invalidateStatesCache();
    return NextResponse.json({ success: true, synced });
  } catch (error) {
    console.error('POST /api/feed/assign:', error);
    return NextResponse.json({ error: error.message || 'assign failed' }, { status: 500 });
  }
}
