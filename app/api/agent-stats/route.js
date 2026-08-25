import { NextResponse } from 'next/server';
import getMongoClient from '../../../lib/mongodb';
import { buildAgentStatsMap, loadStatesMap } from '../../../lib/agentFeedQuery';
import { WORKING_AGENTS } from '../../../lib/agentFeedRules';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentParam = searchParams.get('agent') || '';
    const agents = agentParam ? [agentParam] : WORKING_AGENTS;

    const client = await getMongoClient();
    const statesCollection = client.db('fiesta_crm').collection('supplier_states');
    const statesMap = await loadStatesMap(statesCollection);
    const now = Date.now();

    return NextResponse.json({
      agents: buildAgentStatsMap(statesMap, agents, now),
      at: now,
    });
  } catch (error) {
    console.error('GET /api/agent-stats:', error);
    return NextResponse.json({ error: error.message || 'stats failed' }, { status: 500 });
  }
}
