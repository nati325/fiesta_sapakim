export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
const IL_TZ = 'Asia/Jerusalem';
const WEEKDAY_SUN0 = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function israelParts(ms = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: IL_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const out = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

export function startOfIsraelDay(now = Date.now()) {
  const parts = israelParts(now);
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  for (const offset of ['+03:00', '+02:00']) {
    const stamp = Date.parse(`${ymd}T00:00:00${offset}`);
    if (Number.isNaN(stamp)) continue;
    const check = israelParts(stamp);
    if (check.year === parts.year && check.month === parts.month && check.day === parts.day && check.hour === '00') {
      return stamp;
    }
  }
  return Date.parse(`${ymd}T00:00:00+03:00`);
}

export function israelWeekday(now = Date.now()) {
  return WEEKDAY_SUN0[israelParts(now).weekday] ?? 0;
}

export function startOfIsraelWeek(now = Date.now()) {
  let stamp = startOfIsraelDay(now);
  let guard = 0;
  while (israelWeekday(stamp) !== 0 && guard < 8) {
    stamp = startOfIsraelDay(stamp - 36 * 60 * 60 * 1000);
    guard += 1;
  }
  return stamp;
}

export function israelDayRange(now = Date.now()) {
  const start = startOfIsraelDay(now);
  return { start, end: startOfIsraelDay(start + 36 * 60 * 60 * 1000) };
}

export function israelWeekRange(now = Date.now()) {
  const start = startOfIsraelWeek(now);
  return { start, end: startOfIsraelWeek(start + 8 * DAY_MS) };
}

export function israelPreviousWeekRange(now = Date.now()) {
  const thisWeekStart = startOfIsraelWeek(now);
  return { start: startOfIsraelWeek(thisWeekStart - 36 * 60 * 60 * 1000), end: thisWeekStart };
}

export function weekKeyFromStart(startMs) {
  const parts = israelParts(startMs);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shouldShowWeeklySummaryReminder(now = Date.now()) {
  const day = israelWeekday(now);
  const hour = Number(israelParts(now).hour);
  return (day === 5 && hour >= 14) || day === 6 || day === 0;
}

export function getWeeklySummaryWindow(now = Date.now()) {
  if (israelWeekday(now) === 0) {
    const range = israelPreviousWeekRange(now);
    return { ...range, title: 'סיכום השבוע שעבר', weekKey: weekKeyFromStart(range.start) };
  }
  const range = israelWeekRange(now);
  return { ...range, title: 'סיכום השבוע', weekKey: weekKeyFromStart(range.start) };
}

const CALL_ACTIONS = new Set(['call']);

export function buildActivityEntry(action, agent, details = {}) {
  return {
    at: Date.now(),
    agent: agent || '',
    action,
    ...details,
  };
}

export function resolveActivityAction(newState) {
  if ('outboundCallAt' in newState) return { action: 'call' };
  if ('status' in newState) return { action: 'status', status: newState.status };
  if ('callbackScheduled' in newState) return { action: 'callback', value: newState.callbackScheduled };
  if ('reminder' in newState) return { action: 'reminder', value: newState.reminder };
  if ('notes' in newState) return { action: 'notes' };
  if ('uploadedImage' in newState) return { action: 'upload' };
  return null;
}

export function appendActivityLog(existingLog = [], entry, maxEntries = 100) {
  const log = Array.isArray(existingLog) ? [...existingLog, entry] : [entry];
  return log.length > maxEntries ? log.slice(-maxEntries) : log;
}

function entriesInWindow(log = [], agent, sinceMs, now = Date.now()) {
  if (!Array.isArray(log)) return [];
  const cutoff = now - sinceMs;
  return log.filter((entry) => entry.at >= cutoff && (!agent || entry.agent === agent));
}

export function countAgentCallsBetween(supplierStates, agent, fromMs, toMs) {
  let count = 0;
  Object.values(supplierStates || {}).forEach((state) => {
    const log = Array.isArray(state.activityLog) ? state.activityLog : [];
    count += log.filter((entry) => {
      if (!CALL_ACTIONS.has(entry.action)) return false;
      if (agent && entry.agent !== agent) return false;
      if (fromMs != null && entry.at < fromMs) return false;
      if (toMs != null && entry.at >= toMs) return false;
      return true;
    }).length;
  });
  return count;
}

export function countAgentCalls(supplierStates, agent, sinceMs, now = Date.now()) {
  if (!sinceMs) return countAgentCallsBetween(supplierStates, agent, null, null);
  return countAgentCallsBetween(supplierStates, agent, now - sinceMs, now);
}

export function getAgentCallCounts(supplierStates, agents, now = Date.now()) {
  const day = israelDayRange(now);
  const week = israelWeekRange(now);
  return (agents || []).reduce((result, agent) => {
    result[agent] = {
      today: countAgentCallsBetween(supplierStates, agent, day.start, day.end),
      week: countAgentCallsBetween(supplierStates, agent, week.start, week.end),
      all: countAgentCallsBetween(supplierStates, agent, null, null),
    };
    return result;
  }, {});
}

export function emptyPipelineStats() {
  return { noAnswer: 0, refused: 0, callback: 0, forwarded: 0 };
}

export function countAgentPipelineBetween(supplierStates, agent, fromMs, toMs) {
  const stats = emptyPipelineStats();
  Object.values(supplierStates || {}).forEach((state) => {
    const log = Array.isArray(state.activityLog) ? state.activityLog : [];
    log.forEach((entry) => {
      if (agent && entry.agent !== agent) return;
      if (fromMs != null && entry.at < fromMs) return;
      if (toMs != null && entry.at >= toMs) return;
      if (entry.action === 'status') {
        if (entry.status === 'not-available' || entry.status === 'no-answer') stats.noAnswer += 1;
        else if (entry.status === 'not-interested') stats.refused += 1;
        else if (entry.status === 'not-signed') stats.forwarded += 1;
        else if (entry.status === 'thinking') stats.callback += 1;
      } else if (entry.action === 'callback') {
        stats.callback += 1;
      }
    });
  });
  return stats;
}

function applyStatusToStats(stats, status) {
  stats.total += 1;
  if (status === 'contract' || status === 'closed') stats.closed += 1;
  else if (status === 'not-available' || status === 'no-answer') stats.noAnswer += 1;
  else if (status === 'not-signed') stats.notSigned += 1;
  else if (status === 'thinking') stats.thinking += 1;
}

export function emptyAgentStats() {
  return { total: 0, closed: 0, noAnswer: 0, notSigned: 0, thinking: 0 };
}

export function aggregateAgentStats(supplierStates, agent, sinceMs = null, now = Date.now()) {
  const stats = emptyAgentStats();
  const cutoff = sinceMs ? now - sinceMs : 0;

  Object.values(supplierStates).forEach((state) => {
    if (Array.isArray(state.activityLog) && state.activityLog.length) {
      state.activityLog.forEach((entry) => {
        if (entry.action !== 'status') return;
        if (sinceMs && entry.at < cutoff) return;
        if (agent && entry.agent !== agent) return;
        applyStatusToStats(stats, entry.status);
      });
      return;
    }

    if (!agent || state.agent !== agent) return;

    if (!sinceMs) {
      if (state.status !== null && state.status !== undefined) {
        applyStatusToStats(stats, state.status);
      }
      return;
    }

    if (state.lastTouchedAt >= cutoff && state.status) {
      applyStatusToStats(stats, state.status);
    }
  });

  return stats;
}

export function getManagerStats(supplierStates, agents) {
  return agents.reduce((result, agent) => {
    result[agent] = {
      today: aggregateAgentStats(supplierStates, agent, DAY_MS),
      week: aggregateAgentStats(supplierStates, agent, WEEK_MS),
      all: aggregateAgentStats(supplierStates, agent),
    };
    return result;
  }, {});
}
