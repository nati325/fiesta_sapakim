/**
 * Guards the two copies of the pricing engine against drifting apart.
 *
 * Fiesta and fiesta_sapakim are separate repos that deploy separately, so they
 * cannot import a shared package. The pricing rules are therefore duplicated in
 * `lib/pricing.js` on both sides, and this script is what keeps the duplication
 * honest:
 *
 *   npm run check-pricing
 *
 * An identical copy of this script lives in Fiesta/fiesta-nextjs/scripts/. When
 * only one repo is checked out — on Vercel, or in a fresh clone — the byte
 * comparison is skipped and only the local copy's arithmetic is exercised.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..');

const LOCAL_COPY = path.join(APP_ROOT, 'lib', 'pricing.js');
const SIBLING_COPY = path.resolve(APP_ROOT, '..', 'Fiesta', 'fiesta-nextjs', 'lib', 'pricing.js');

/** listPrice, discount%, commission% -> expected derived values. */
const CASES = [
  { list: 12000, discount: 20, commission: 15, clientPrice: 9600, savings: 2400, fee: 1800 },
  { list: 25000, discount: 20, commission: 15, clientPrice: 20000, savings: 5000, fee: 3750 },
  { list: 800, discount: 20, commission: 15, clientPrice: 640, savings: 160, fee: 120 },
  { list: 9250, discount: 19.5, commission: 15, clientPrice: 7446, savings: 1804, fee: 1388 },
  { list: '₪12,000', discount: 0, commission: 0, clientPrice: 12000, savings: 0, fee: 0 },
  { list: 0, discount: 20, commission: 15, clientPrice: 0, savings: 0, fee: 0 },
];

const failures = [];

const read = async (file) => {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
};

const local = await read(LOCAL_COPY);
if (local === null) {
  failures.push('חסר lib/pricing.js באפליקציה הזו');
}

const sibling = await read(SIBLING_COPY);
if (sibling === null) {
  console.log('· Fiesta לא נמצא לצד האפליקציה — מדלגים על השוואת העותקים');
} else if (local !== null && local !== sibling) {
  failures.push(
    'שני העותקים של pricing.js אינם זהים:\n' +
      `  - ${LOCAL_COPY}\n` +
      `  - ${SIBLING_COPY}\n` +
      '  העתק את הגרסה הנכונה על השנייה כדי לסנכרן.'
  );
}

if (local !== null) {
  const pricing = await import(pathToFileURL(LOCAL_COPY).href);

  for (const c of CASES) {
    const got = pricing.priceProduct(c.list, c.discount, c.commission);
    const expected = { clientPrice: c.clientPrice, savings: c.savings, commission: c.fee };
    for (const [key, want] of Object.entries(expected)) {
      if (got[key] !== want) {
        failures.push(
          `מחירון ${c.list}, הנחה ${c.discount}%, עמלה ${c.commission}% — ` +
            `${key} יצא ${got[key]} במקום ${want}`
        );
      }
    }
  }
}

if (failures.length) {
  console.error('בדיקת סנכרון התמחור נכשלה:\n');
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}

const scope = sibling === null ? 'העותק המקומי' : 'שני העותקים זהים';
console.log(`בדיקת סנכרון התמחור עברה — ${scope}, ${CASES.length} מקרי חישוב תקינים.`);
