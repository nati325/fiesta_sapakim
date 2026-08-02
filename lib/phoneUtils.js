/** Canonical phone key for state maps — digits only, local format. */
export function phoneKey(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972') && digits.length >= 11) digits = `0${digits.slice(3)}`;
  return digits;
}

export function formatPhoneDisplay(phone) {
  const d = phoneKey(phone);
  if (!d) return '';
  if (d.length === 10 && d.startsWith('05')) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 9 && d.startsWith('0')) return `${d.slice(0, 2)}-${d.slice(2)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

/** Re-key an object keyed by phone strings. */
export function rekeyByPhone(map = {}) {
  const out = {};
  for (const [key, value] of Object.entries(map || {})) {
    const nk = phoneKey(key);
    if (!nk) continue;
    out[nk] = { ...(out[nk] || {}), ...value };
  }
  return out;
}

export function getSupplierState(states, phone) {
  if (!states || !phone) return {};
  return states[phoneKey(phone)] || {};
}
