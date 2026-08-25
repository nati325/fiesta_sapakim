/** Event types for the CRM → Fiesta push. Keep labels in sync with Fiesta/lib/eventTypes.js. */

export const ALL_EVENTS_LABEL = 'מתאים לכל האירועים';

export const FIESTA_EVENT_TYPES = [
  'חתונה',
  'בר מצווה',
  'בת מצווה',
  'ברית',
  'אירוע עסקי',
  'יום הולדת',
];

export function emptyEventPriceRow() {
  return { originalPrice: '', discountPercent: '', commissionPercent: '' };
}

export function needsPriceDifferenceChoice({ fitsAllEvents, eventTypes } = {}) {
  if (fitsAllEvents) return true;
  return (eventTypes || []).filter(Boolean).length >= 2;
}

export function normalizePushEventTypes({ fitsAllEvents, eventTypes } = {}) {
  if (fitsAllEvents) return [ALL_EVENTS_LABEL];
  const selected = [...new Set((eventTypes || []).map((t) => String(t || '').trim()).filter(Boolean))];
  return selected;
}
