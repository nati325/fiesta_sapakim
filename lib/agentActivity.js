export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

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

export function countAgentCalls(supplierStates, agent, sinceMs, now = Date.now()) {
  let count = 0;

  Object.values(supplierStates).forEach((state) => {
    const log = Array.isArray(state.activityLog) ? state.activityLog : [];
    const entries = sinceMs
      ? entriesInWindow(log, agent, sinceMs, now)
      : log.filter((entry) => !agent || entry.agent === agent);
    count += entries.filter((entry) => CALL_ACTIONS.has(entry.action)).length;
  });

  return count;
}

export function getAgentCallCounts(supplierStates, agents, now = Date.now()) {
  return (agents || []).reduce((result, agent) => {
    result[agent] = {
      today: countAgentCalls(supplierStates, agent, DAY_MS, now),
      week: countAgentCalls(supplierStates, agent, WEEK_MS, now),
      all: countAgentCalls(supplierStates, agent, null, now),
    };
    return result;
  }, {});
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
