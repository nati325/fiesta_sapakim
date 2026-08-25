import { phoneKey } from './phoneUtils.js';
import {
  countSuppliersInMongo,
  getSuppliersCollection,
  mongoDocToSupplier,
} from './suppliersMongo.js';
import { loadSuppliersFromJson, normalizeSupplierRecord } from './supplierEnrichment.js';
import {
  countAgentCallsBetween,
  countAgentPipelineBetween,
  israelDayRange,
  israelWeekRange,
} from './agentActivity.js';
import {
  VIEW_ALL_AGENTS,
  WORKING_AGENTS,
  agentKeywordList,
  decodeFeedCursor,
  encodeFeedCursor,
  defaultFeedLimit,
  isValidSupplierRow,
  resolveSupplierTab,
  supplierBelongsToAgent,
  supplierInYinonView,
} from './agentFeedRules.js';

function normalizeRow(s) {
  const category = s.Category || s.category || '';
  const supplierName = (s['Supplier Name'] || s.name || s.Name || s.clean_name || '').trim();
  const cleanName = (s.clean_name || supplierName.split('|')[0]?.trim() || supplierName).trim();
  const realPhone = s['Real Phone'] || s.real_phone || s.phone || s['Phone Number'] || '';
  return {
    ...s,
    id: s.id ?? null,
    clean_name: cleanName,
    'Supplier Name': supplierName || cleanName || 'ספק ללא שם',
    'Real Phone': realPhone,
    phone: realPhone,
    Category: category.trim() !== '' ? category : 'ספקים ללא קטגוריה',
    Address: s.Address || s.address || '',
    Website: s.Website || s.website || '',
    URL: s.URL || s.engaged_url || '',
    engaged_url: s.engaged_url || s.URL || '',
    description: s.description || '',
    images: s.images || [],
    reviews: s.reviews || [],
  };
}

const candidateCache = new Map();
const CANDIDATE_TTL_MS = 60_000;
let statesCache = { at: 0, map: null };
const STATES_TTL_MS = 30_000;

export function invalidateStatesCache() {
  statesCache = { at: 0, map: null };
}

export function invalidateCandidateCache() {
  candidateCache.clear();
}

/** Drop heavy fields before sending card states to the browser. */
function leanStateForClient(state = {}) {
  if (!state || typeof state !== 'object') return {};
  const {
    activityLog,
    uploadedImage,
    _id,
    ...rest
  } = state;
  const lean = { ...rest };
  if (uploadedImage && String(uploadedImage).startsWith('data:')) {
    lean.uploadedImage = '[stored]';
  } else if (uploadedImage) {
    lean.uploadedImage = uploadedImage;
  }
  return lean;
}

async function findSuppliersForAgentKeywords(keywords) {
  const col = await getSuppliersCollection();
  const filter = {};
  if (keywords.length) {
    const escaped = keywords.map((kw) => String(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    filter.searchText = { $regex: escaped.join('|'), $options: 'i' };
  }

  const projection = {
    phoneKey: 1,
    id: 1,
    name: 1,
    clean_name: 1,
    real_phone: 1,
    phone: 1,
    category: 1,
    address: 1,
    website: 1,
    engaged_url: 1,
    images: { $slice: 1 },
    google_rating: 1,
    reviews_count: 1,
    searchText: 1,
  };

  const docs = await col.find(filter, { projection }).sort({ name: 1, id: 1 }).toArray();
  return docs.map((doc) => mongoDocToSupplier(doc, { lite: true }));
}

async function loadAgentCandidateSuppliers(agent, yinonWorkGroup) {
  const keywords = agentKeywordList(agent, yinonWorkGroup);
  const cacheKey = `${agent}|${yinonWorkGroup || ''}|${keywords.join(',')}`;
  const cached = candidateCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CANDIDATE_TTL_MS) {
    return cached.rows;
  }

  let rows = [];
  try {
    const mongoCount = await countSuppliersInMongo();
    if (mongoCount > 0) {
      const suppliers = await findSuppliersForAgentKeywords(keywords);
      rows = suppliers.map(normalizeRow).filter(isValidSupplierRow);
    }
  } catch (err) {
    console.warn('feed Mongo load failed, JSON fallback:', err.message);
  }

  if (!rows.length) {
    const { list } = loadSuppliersFromJson();
    rows = list
      .map((item) => normalizeRow(normalizeSupplierRecord(item)))
      .filter(isValidSupplierRow);
  }

  candidateCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

export async function loadStatesMap(collection, { force = false } = {}) {
  if (!force && statesCache.map && Date.now() - statesCache.at < STATES_TTL_MS) {
    return statesCache.map;
  }

  const docs = await collection
    .find(
      {},
      {
        projection: {
          uploadedImage: 0,
        },
      }
    )
    .toArray();
  const map = {};
  for (const doc of docs) {
    const key = phoneKey(doc.phone || doc.phoneKey);
    if (!key) continue;
    const { _id, ...rest } = doc;
    map[key] = { ...(map[key] || {}), ...rest, phone: key, phoneKey: key };
  }
  statesCache = { at: Date.now(), map };
  return map;
}

function filterFeedPool(suppliers, statesMap, { agent, tab, yinonWorkGroup }) {
  return suppliers
    .filter((s) => {
      const key = phoneKey(s['Real Phone'] || s.phone);
      const state = statesMap[key] || {};
      if (!supplierBelongsToAgent(s, agent, state)) return false;
      if (agent === 'ינון' && !supplierInYinonView(s, yinonWorkGroup || 'makeup')) return false;
      const resolved = resolveSupplierTab(state, agent);
      if (tab) return resolved === tab;
      return resolved != null;
    })
    .sort((a, b) => {
      const nameA = (a['Supplier Name'] || a.clean_name || '').trim();
      const nameB = (b['Supplier Name'] || b.clean_name || '').trim();
      return nameA.localeCompare(nameB, 'he');
    });
}

function pickStatesForSuppliers(suppliers, statesMap) {
  const out = {};
  for (const s of suppliers) {
    const key = phoneKey(s['Real Phone'] || s.phone);
    if (key && statesMap[key]) out[key] = leanStateForClient(statesMap[key]);
  }
  return out;
}

/**
 * Paginated agent feed for a tab.
 * @returns {{ suppliers, states, nextCursor, hasMore, totalMatching, limit, skip }}
 */
export async function queryAgentFeed({
  agent,
  tab = 'לא נגעו בכלל',
  yinonWorkGroup = 'makeup',
  limit,
  cursor = '',
  excludePhones = [],
  statesCollection,
  statesMap: preloadedStates = null,
}) {
  const pageLimit = Math.min(Math.max(Number(limit) || defaultFeedLimit(agent), 1), 50);
  const skip = decodeFeedCursor(cursor);
  const exclude = new Set((excludePhones || []).map((p) => phoneKey(p)).filter(Boolean));

  const [candidates, statesMap] = await Promise.all([
    loadAgentCandidateSuppliers(agent, agent === 'ינון' ? yinonWorkGroup : ''),
    preloadedStates || loadStatesMap(statesCollection),
  ]);

  let pool = filterFeedPool(candidates, statesMap, { agent, tab, yinonWorkGroup });
  if (exclude.size) {
    pool = pool.filter((s) => !exclude.has(phoneKey(s['Real Phone'] || s.phone)));
  }

  const slice = pool.slice(skip, skip + pageLimit);
  const nextSkip = skip + slice.length;
  const hasMore = nextSkip < pool.length;

  return {
    suppliers: slice,
    states: pickStatesForSuppliers(slice, statesMap),
    nextCursor: hasMore ? encodeFeedCursor(nextSkip) : null,
    hasMore,
    totalMatching: pool.length,
    limit: pageLimit,
    skip,
  };
}

/** Fetch one (or N) next untouched suppliers, excluding phones already on screen. */
export async function queryFeedRefill({
  agent,
  tab = 'לא נגעו בכלל',
  yinonWorkGroup = 'makeup',
  count = 1,
  excludePhones = [],
  statesCollection,
}) {
  const result = await queryAgentFeed({
    agent,
    tab,
    yinonWorkGroup,
    limit: Math.max(1, Number(count) || 1),
    cursor: '',
    excludePhones,
    statesCollection,
  });
  return {
    suppliers: result.suppliers,
    states: result.states,
    totalMatching: result.totalMatching,
  };
}

export async function queryTabCounts({
  agent,
  yinonWorkGroup = 'makeup',
  statesCollection,
  statesMap: preloadedStates = null,
}) {
  const [candidates, statesMap] = await Promise.all([
    loadAgentCandidateSuppliers(agent, agent === 'ינון' ? yinonWorkGroup : ''),
    preloadedStates || loadStatesMap(statesCollection),
  ]);

  const counts = {
    'לא נגעו בכלל': 0,
    'לחזור אליהם': 0,
    'לא ענו': 0,
    'עדיין לא חתם': 0,
    סירבו: 0,
    טופלו: 0,
  };

  let total = 0;
  let touched = 0;

  for (const s of candidates) {
    const key = phoneKey(s['Real Phone'] || s.phone);
    const state = statesMap[key] || {};
    if (!supplierBelongsToAgent(s, agent, state)) continue;
    if (agent === 'ינון' && !VIEW_ALL_AGENTS.has(agent)) {
      if (!supplierInYinonView(s, yinonWorkGroup || 'makeup')) continue;
    }
    const tab = resolveSupplierTab(state, agent);
    if (!tab) continue;
    if (counts[tab] != null) counts[tab] += 1;
    total += 1;
    if (tab !== 'לא נגעו בכלל') touched += 1;
  }

  return {
    counts,
    feedStats: {
      total,
      touched,
      untouched: counts['לא נגעו בכלל'] || 0,
    },
  };
}

export function buildAgentStatsMap(statesMap, agents = WORKING_AGENTS, now = Date.now()) {
  const day = israelDayRange(now);
  const week = israelWeekRange(now);
  const result = {};
  for (const agent of agents) {
    result[agent] = {
      calls: {
        today: countAgentCallsBetween(statesMap, agent, day.start, day.end),
        week: countAgentCallsBetween(statesMap, agent, week.start, week.end),
        all: countAgentCallsBetween(statesMap, agent, null, null),
      },
      pipeline: {
        today: countAgentPipelineBetween(statesMap, agent, day.start, day.end),
        week: countAgentPipelineBetween(statesMap, agent, week.start, week.end),
      },
    };
  }
  return result;
}

/** One round-trip: stats + tab counts + first feed page. */
export async function queryAgentBootstrap({
  agent,
  tab = 'לא נגעו בכלל',
  yinonWorkGroup = 'makeup',
  limit,
  statesCollection,
  statsAgents = null,
}) {
  const statesMap = await loadStatesMap(statesCollection);
  const agentsForStats =
    statsAgents ||
    (agent === 'ינון' ? WORKING_AGENTS : [agent]);

  const [feed, tabs, agents] = await Promise.all([
    queryAgentFeed({
      agent,
      tab,
      yinonWorkGroup,
      limit: limit || defaultFeedLimit(agent),
      cursor: '',
      statesCollection,
      statesMap,
    }),
    queryTabCounts({
      agent,
      yinonWorkGroup,
      statesCollection,
      statesMap,
    }),
    Promise.resolve(buildAgentStatsMap(statesMap, agentsForStats)),
  ]);

  return {
    agents,
    counts: tabs.counts,
    feedStats: tabs.feedStats,
    feed,
    at: Date.now(),
  };
}
