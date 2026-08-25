/** Shared agent/tab feed rules — used by server APIs and (where needed) the client. */

export const WORKING_AGENTS = ['ינון', 'הודיה', 'טל'];
export const VIEW_ALL_AGENTS = new Set(['נתנאל', 'מאגר כללי']);

export const YINON_WORK_GROUPS = [
  { id: 'makeup', label: 'מאפרות', keywords: ['מאפר', 'איפור', 'makeup', 'mua'] },
  { id: 'dresses', label: 'שמלות כלה', keywords: ['שמלות כלה', 'שמלת כלה', 'שמלות', 'bridal dress', 'bridal gown', 'gown'] },
  { id: 'hair', label: 'עיצוב שיער', keywords: ['עיצוב שיער', 'מסרק', 'תסרוק', 'שיער', 'hair style', 'braids', 'צמות'] },
];

export const PHOTO_KEYWORDS = ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל', 'photographer', 'photography', 'video'];
export const DJ_KEYWORDS = ['מוזיקה', "די ג'יי", 'די ג׳יי', 'דיג׳י', 'דיגיי', 'תקליטן', 'dj', 'music'];

export const STATUS_ORDER = ['לא נגעו בכלל', 'לחזור אליהם', 'לא ענו', 'עדיין לא חתם', 'סירבו', 'טופלו'];

export const DEFAULT_FEED_LIMIT = 10;
export const VIEW_ALL_FEED_LIMIT = 20;

export function supplierSearchText(supplier) {
  return [
    supplier?.Category,
    supplier?.category,
    supplier?.['Supplier Name'],
    supplier?.name,
    supplier?.clean_name,
    supplier?.description,
    supplier?.searchText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function textMatchesKeywords(text, keywords) {
  const hay = String(text || '').toLowerCase();
  return keywords.some((kw) => hay.includes(String(kw).toLowerCase()));
}

export function getYinonWorkGroup(supplier) {
  const text = supplierSearchText(supplier);
  if (!text) return null;
  if (textMatchesKeywords(text, YINON_WORK_GROUPS[0].keywords)) return 'makeup';
  if (textMatchesKeywords(text, YINON_WORK_GROUPS[2].keywords)) return 'hair';
  if (textMatchesKeywords(text, YINON_WORK_GROUPS[1].keywords)) return 'dresses';
  return null;
}

export function isPhotographerSupplier(supplier) {
  return textMatchesKeywords(supplierSearchText(supplier), PHOTO_KEYWORDS);
}

export function isDjSupplier(supplier) {
  return textMatchesKeywords(supplierSearchText(supplier), DJ_KEYWORDS);
}

export function isValidSupplierRow(s) {
  const name = (s?.['Supplier Name'] || s?.clean_name || '').trim();
  const phone = s?.['Real Phone'] || s?.phone || '';
  return Boolean(name && name !== 'ספק ללא שם' && phone && phone !== 'FAILED' && phone !== 'N/A');
}

export function supplierBelongsToAgent(supplier, agent) {
  if (!agent || VIEW_ALL_AGENTS.has(agent)) return true;
  if (agent === 'ינון') return getYinonWorkGroup(supplier) != null;
  if (agent === 'הודיה') return isPhotographerSupplier(supplier);
  if (agent === 'טל') return isDjSupplier(supplier);
  return true;
}

export function supplierInYinonView(supplier, yinonWorkGroup) {
  if (!yinonWorkGroup) return getYinonWorkGroup(supplier) != null;
  return getYinonWorkGroup(supplier) === yinonWorkGroup;
}

export function isSupplierTouched(state = {}) {
  if (!state) return false;
  if (state.status) return true;
  if (state.callbackScheduled) return true;
  if (state.reminder) return true;
  if (state.notes && String(state.notes).trim()) return true;
  if (state.uploadedImage) return true;
  if (state.firstTouchedAt) return true;
  return false;
}

export function moranTouchedState(state = {}) {
  if (!state) return false;
  if (state.firstTouchedBy === 'מורן' || state.lastTouchedBy === 'מורן') return true;
  if (state.agent === 'מורן' || state.assignedAgent === 'מורן') return true;
  return Array.isArray(state.activityLog) && state.activityLog.some((entry) => entry.agent === 'מורן');
}

export function agentHasWorkedSupplier(state = {}, agent) {
  if (!agent || VIEW_ALL_AGENTS.has(agent)) return isSupplierTouched(state);
  if (!state) return false;
  if (agent === 'ינון' && moranTouchedState(state)) return true;
  if ((agent === 'הודיה' || agent === 'טל') && isSupplierTouched(state)) return true;
  if (state.firstTouchedBy === agent || state.lastTouchedBy === agent) return true;
  if (state.agent === agent) return true;
  if (Array.isArray(state.activityLog) && state.activityLog.some((entry) => entry.agent === agent)) {
    return true;
  }
  return false;
}

export function resolveSupplierTab(state = {}, agent) {
  if (state?.status === 'irrelevant') return null;
  const scoped = agentHasWorkedSupplier(state, agent) ? state : {};
  const isHandled = scoped.status === 'not-interested' || scoped.status === 'contract';
  const isCallback =
    !!scoped.callbackScheduled || scoped.status === 'thinking' || scoped.status === 'no-answer';

  if (!isSupplierTouched(scoped)) return 'לא נגעו בכלל';
  if (scoped.status === 'not-available') return 'לא ענו';
  if (scoped.status === 'not-signed') return 'עדיין לא חתם';
  if (WORKING_AGENTS.includes(agent) && scoped.status === 'not-interested') return 'סירבו';
  if (isHandled) return 'טופלו';
  if (isCallback) return 'לחזור אליהם';
  return null;
}

/** Keywords used to prefilter Mongo searchText for an agent (+ optional Yinon subgroup). */
export function agentKeywordList(agent, yinonWorkGroup = '') {
  if (VIEW_ALL_AGENTS.has(agent)) return [];
  if (agent === 'הודיה') return PHOTO_KEYWORDS;
  if (agent === 'טל') return DJ_KEYWORDS;
  if (agent === 'ינון') {
    const group = YINON_WORK_GROUPS.find((g) => g.id === yinonWorkGroup) || null;
    if (group) return group.keywords;
    return YINON_WORK_GROUPS.flatMap((g) => g.keywords);
  }
  return [];
}

export function encodeFeedCursor(skip) {
  return Buffer.from(JSON.stringify({ skip: Number(skip) || 0 }), 'utf8').toString('base64url');
}

export function decodeFeedCursor(cursor) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const skip = Number(parsed?.skip);
    return Number.isFinite(skip) && skip > 0 ? skip : 0;
  } catch {
    return 0;
  }
}

export function defaultFeedLimit(agent) {
  return VIEW_ALL_AGENTS.has(agent) ? VIEW_ALL_FEED_LIMIT : DEFAULT_FEED_LIMIT;
}
