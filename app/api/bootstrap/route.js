import { NextResponse } from 'next/server';
import getMongoClient from '../../../lib/mongodb';
import { queryAgentBootstrap } from '../../../lib/agentFeedQuery';
import { defaultFeedLimit } from '../../../lib/agentFeedRules';
import { phoneKey } from '../../../lib/phoneUtils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const agent = searchParams.get('agent') || '';
    const tab = searchParams.get('tab') || 'לא נגעו בכלל';
    const yinonWorkGroup = searchParams.get('yinonWorkGroup') || 'makeup';
    const limit = Number(searchParams.get('limit')) || defaultFeedLimit(agent);

    if (!agent) {
      return NextResponse.json({ error: 'agent required' }, { status: 400 });
    }

    const client = await getMongoClient();
    const statesCollection = client.db('fiesta_crm').collection('supplier_states');

    const payload = await queryAgentBootstrap({
      agent,
      tab,
      yinonWorkGroup,
      limit,
      statesCollection,
    });

    // Optimistic assign fields only — persistence is client-triggered via /api/feed/assign.
    if (tab === 'לא נגעו בכלל' && payload.feed?.suppliers?.length) {
      for (const supplier of payload.feed.suppliers) {
        const key = phoneKey(supplier['Real Phone'] || supplier.phone);
        if (!key) continue;
        payload.feed.states[key] = {
          ...(payload.feed.states[key] || {}),
          assignedAgent: agent,
          assignedCategory: supplier.Category || 'כללי',
          supplierName: supplier['Supplier Name'] || supplier.clean_name || '',
          phone: key,
          phoneKey: key,
        };
      }
    }

    return NextResponse.json(payload, {
      headers: {
        'X-Feed-Count': String(payload.feed?.suppliers?.length || 0),
        'X-Feed-Total': String(payload.feed?.totalMatching || 0),
      },
    });
  } catch (error) {
    console.error('GET /api/bootstrap:', error);
    return NextResponse.json({ error: error.message || 'bootstrap failed' }, { status: 500 });
  }
}
