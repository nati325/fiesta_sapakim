import { NextResponse } from 'next/server';
import getMongoClient from '../../../lib/mongodb';
import { queryAgentFeed, queryFeedRefill } from '../../../lib/agentFeedQuery';
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
    const cursor = searchParams.get('cursor') || '';
    const refill = searchParams.get('refill') === '1';
    const limit = Number(searchParams.get('limit')) || defaultFeedLimit(agent);
    const excludePhones = (searchParams.get('exclude') || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (!agent) {
      return NextResponse.json({ error: 'agent required' }, { status: 400 });
    }

    const client = await getMongoClient();
    const statesCollection = client.db('fiesta_crm').collection('supplier_states');

    const result = refill
      ? await queryFeedRefill({
          agent,
          tab,
          yinonWorkGroup,
          count: limit,
          excludePhones,
          statesCollection,
        })
      : await queryAgentFeed({
          agent,
          tab,
          yinonWorkGroup,
          limit,
          cursor,
          excludePhones,
          statesCollection,
        });

    if (tab === 'לא נגעו בכלל' && result.suppliers?.length) {
      for (const supplier of result.suppliers) {
        const key = phoneKey(supplier['Real Phone'] || supplier.phone);
        if (!key) continue;
        result.states[key] = {
          ...(result.states[key] || {}),
          assignedAgent: agent,
          assignedCategory: supplier.Category || 'כללי',
          supplierName: supplier['Supplier Name'] || supplier.clean_name || '',
          phone: key,
          phoneKey: key,
        };
      }
    }

    return NextResponse.json(result, {
      headers: {
        'X-Feed-Count': String(result.suppliers?.length || 0),
        'X-Feed-Total': String(result.totalMatching || 0),
      },
    });
  } catch (error) {
    console.error('GET /api/feed:', error);
    return NextResponse.json({ error: error.message || 'feed failed' }, { status: 500 });
  }
}
