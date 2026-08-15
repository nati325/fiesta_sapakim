const SESSION_KEY = 'fiesta_crm_session';
const UI_KEY = 'fiesta_crm_ui';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode errors
  }
}

export function loadSession() {
  const data = readJson(SESSION_KEY, null);
  if (!data?.agent || !data?.expiresAt || Date.now() > data.expiresAt) {
    if (typeof window !== 'undefined') localStorage.removeItem(SESSION_KEY);
    return null;
  }
  return { agent: data.agent };
}

export function saveSession(agent) {
  writeJson(SESSION_KEY, {
    agent,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY);
}

export function loadUiState(agent) {
  if (!agent) return null;
  const all = readJson(UI_KEY, {});
  return all[agent] || null;
}

export function saveUiState(agent, partial) {
  if (!agent) return;
  const all = readJson(UI_KEY, {});
  all[agent] = {
    ...(all[agent] || {}),
    ...partial,
    updatedAt: Date.now(),
  };
  writeJson(UI_KEY, all);
}

const WEEKLY_SUMMARY_KEY = 'fiesta_crm_weekly_summary';

export function isWeeklySummaryDismissed(weekKey) {
  if (!weekKey) return false;
  const data = readJson(WEEKLY_SUMMARY_KEY, {});
  return data.dismissedWeekKey === weekKey;
}

export function dismissWeeklySummary(weekKey) {
  if (!weekKey) return;
  writeJson(WEEKLY_SUMMARY_KEY, {
    dismissedWeekKey: weekKey,
    dismissedAt: Date.now(),
  });
}

export function getSupplierPhone(supplier) {
  if (!supplier) return null;
  return supplier['Real Phone'] || supplier['Phone Number'] || supplier.phone || null;
}
