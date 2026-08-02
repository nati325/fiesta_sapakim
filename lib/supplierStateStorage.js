import { phoneKey, rekeyByPhone } from './phoneUtils.js';

const STATES_KEY = 'fiesta_crm_supplier_states';

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
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function isTouchedSupplierState(state = {}) {
  if (!state) return false;
  if (state.status) return true;
  if (state.callbackScheduled) return true;
  if (state.reminder) return true;
  if (state.notes && String(state.notes).trim()) return true;
  if (state.uploadedImage) return true;
  if (state.firstTouchedAt) return true;
  if (Array.isArray(state.activityLog) && state.activityLog.length) return true;
  return false;
}

export function loadAllSupplierStatesLocal() {
  return rekeyByPhone(readJson(STATES_KEY, {}));
}

export function saveSupplierStateLocal(phone, state) {
  const key = phoneKey(phone);
  if (!key) return;
  const all = loadAllSupplierStatesLocal();
  all[key] = { ...(all[key] || {}), ...state, phone: formatPhoneForStorage(phone) };
  writeJson(STATES_KEY, pickTouchedStates(all));
}

function formatPhoneForStorage(phone) {
  const key = phoneKey(phone);
  if (!key) return phone;
  if (key.length === 10 && key.startsWith('05')) return `${key.slice(0, 3)}-${key.slice(3)}`;
  if (key.length === 9 && key.startsWith('0')) return `${key.slice(0, 2)}-${key.slice(2)}`;
  return key;
}

function pickTouchedStates(states = {}) {
  const out = {};
  for (const [key, state] of Object.entries(states)) {
    if (isTouchedSupplierState(state)) out[key] = state;
  }
  return out;
}

/** Persist only touched rows — avoids localStorage quota with 4k+ suppliers. */
export function saveAllSupplierStatesLocal(states = {}) {
  if (!states || typeof states !== 'object') return false;
  return writeJson(STATES_KEY, pickTouchedStates(rekeyByPhone(states)));
}
