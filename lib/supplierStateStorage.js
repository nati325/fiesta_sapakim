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
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode errors
  }
}

export function loadAllSupplierStatesLocal() {
  return readJson(STATES_KEY, {});
}

export function saveSupplierStateLocal(phone, state) {
  if (!phone) return;
  const all = loadAllSupplierStatesLocal();
  all[phone] = { ...(all[phone] || {}), ...state, phone };
  writeJson(STATES_KEY, all);
}

export function saveAllSupplierStatesLocal(states = {}) {
  if (!states || typeof states !== 'object') return;
  writeJson(STATES_KEY, states);
}
