import { NextResponse } from 'next/server';
import getMongoClient from '../../../lib/mongodb';
import { queryTabCounts } from '../../../lib/agentFeedQuery';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const agent = searchParams.get('agent') || '';
    const yinonWorkGroup = searchParams.get('yinonWorkGroup') || 'makeup';

    if (!agent) {
      return NextResponse.json({ error: 'agent required' }, { status: 400 });
    }

    const client = await getMongoClient();
    const statesCollection = client.db('fiesta_crm').collection('supplier_states');
    const data = await queryTabCounts({ agent, yinonWorkGroup, statesCollection });

    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/tab-counts:', error);
    return NextResponse.json({ error: error.message || 'tab-counts failed' }, { status: 500 });
  }
}
