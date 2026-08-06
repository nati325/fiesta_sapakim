/**
 * End-to-end check of the multi-product flow against the real Fiesta database.
 *
 * Creates one clearly-marked throwaway vendor, walks it through the whole path
 * (admin save -> site display -> agent re-push -> agent push with products) and
 * deletes it again. It refuses to run if anything already matches the test
 * identity, and the cleanup runs even when an assertion fails.
 *
 *   npm run e2e-products
 *
 * The display assertions read Fiesta's own helpers, so the Fiesta repo has to be
 * checked out next to this one. Without it the script stops before touching the
 * database.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { MongoClient } from 'mongodb';

import { priceProduct } from '../lib/pricing.js';
import { pushSupplierToFiesta } from '../lib/fiestaPushCore.js';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const VENDOR_PRICE = path.resolve(APP_ROOT, '..', 'Fiesta', 'fiesta-nextjs', 'lib', 'vendorPrice.js');

if (!existsSync(VENDOR_PRICE)) {
  console.log('· Fiesta לא נמצא לצד האפליקציה — הבדיקה דורשת את שני הריפוזיטוריז. מדלגים.');
  process.exit(0);
}

const { getVendorDisplayPrice, getPackages, getAddons } = await import(pathToFileURL(VENDOR_PRICE).href);

const TEST_NAME = '__E2E__ ספק בדיקת מוצרים';
const TEST_PHONE = '0599999901';
const DISCOUNT = 20;
const COMMISSION = 15;

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, label, actual, expected });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — קיבלנו ${JSON.stringify(actual)}, ציפינו ל-${JSON.stringify(expected)}`}`);
}

async function readEnvValue(file, key) {
  const raw = await readFile(path.join(APP_ROOT, file), 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} לא נמצא ב-${file}`);
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
}

function buildProduct(id, name, listPrice, kind) {
  const computed = priceProduct(listPrice, DISCOUNT, COMMISSION);
  return {
    id,
    name,
    description: '',
    originalPrice: String(computed.listPrice),
    price: String(computed.clientPrice),
    image: '',
    kind,
    commissionAmount: computed.commission,
    order: 0,
    active: true,
  };
}

const uri = await readEnvValue('.env.local', 'FIESTA_MONGODB_URI');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const vendors = client.db('fiesta').collection('vendors');

let created = false;
try {
  console.log('\n[0] בדיקת בטיחות — שאין התנגשות עם ספק אמיתי');
  const collision = await vendors.countDocuments({
    $or: [{ name: TEST_NAME }, { contact: TEST_PHONE }],
  });
  if (collision > 0) {
    throw new Error(`נמצאו ${collision} מסמכים תואמים לזהות הבדיקה — עוצר לפני שנוגעים במשהו`);
  }
  console.log('  ✓ נקי, ממשיכים');

  console.log('\n[1] שמירה מהאדמין — שתי חבילות ותוספת');
  const products = [
    buildProduct('p1', 'שמלה מהקולקציה', 12000, 'main'),
    buildProduct('p2', 'שמלה בעיצוב אישי', 25000, 'main'),
    buildProduct('p3', 'הסרת שובל', 800, 'addon'),
  ];
  check('מחיר ללקוח לחבילה הזולה', products[0].price, '9600');
  check('עמלה על החבילה הזולה (אחוז מהמחירון)', products[0].commissionAmount, 1800);
  check('עמלה על התוספת', products[2].commissionAmount, 120);

  const insert = await vendors.insertOne({
    name: TEST_NAME,
    type: 'dresses',
    contact: TEST_PHONE,
    region: 'מרכז',
    description: 'ספק בדיקה אוטומטי',
    discount: String(DISCOUNT),
    discountType: 'percent',
    commissionPercent: COMMISSION,
    // Mirrors what buildVendorPayload writes from the cheapest package.
    price: products[0].price,
    originalPrice: products[0].originalPrice,
    commissionAmount: products[0].commissionAmount,
    mainProductId: 'p1',
    products,
    portfolio: [],
    createdAt: new Date(),
  });
  created = true;
  console.log(`  ✓ נוצר ספק בדיקה ${insert.insertedId}`);

  console.log('\n[2] איך האתר מציג אותו');
  const saved = await vendors.findOne({ _id: insert.insertedId });
  const priceInfo = getVendorDisplayPrice(saved);
  check('מחיר על הכרטיס', priceInfo.display, '₪9,600');
  check('מסומן כ"החל מ־"', priceInfo.isFrom, true);
  check('מספר חבילות', getPackages(saved).length, 2);
  check('מספר תוספות', getAddons(saved).length, 1);
  check('התוספת הזולה לא חטפה את מחיר הכרטיס', priceInfo.raw !== '640', true);

  console.log('\n[3] הסוכן דוחף שוב בלי מוצרים — המוצרים חייבים לשרוד');
  await pushSupplierToFiesta({
    vendorsCollection: vendors,
    supplier: { 'Supplier Name': TEST_NAME, 'Real Phone': TEST_PHONE, images: [] },
    fiestaData: { type: 'dresses', description: 'עודכן מהסוכן', products: [], agentName: 'e2e' },
    origin: '',
    updateIfExists: true,
  });
  const afterBlankPush = await vendors.findOne({ _id: insert.insertedId });
  check('מספר מוצרים אחרי דחיפה ריקה', afterBlankPush.products?.length, 3);
  check('mainProductId שרד', afterBlankPush.mainProductId, 'p1');
  check('התיאור כן התעדכן', afterBlankPush.description, 'עודכן מהסוכן');

  console.log('\n[4] הסוכן דוחף עם מוצרים — אלה כן מחליפים');
  await pushSupplierToFiesta({
    vendorsCollection: vendors,
    supplier: { 'Supplier Name': TEST_NAME, 'Real Phone': TEST_PHONE, images: [] },
    fiestaData: {
      type: 'dresses',
      products: [buildProduct('p9', 'חבילה חדשה מהסוכן', 5000, 'main')],
      mainProductId: 'p9',
      agentName: 'e2e',
    },
    origin: '',
    updateIfExists: true,
  });
  const afterRealPush = await vendors.findOne({ _id: insert.insertedId });
  check('מספר מוצרים אחרי דחיפה עם מוצרים', afterRealPush.products?.length, 1);
  check('המוצר החדש נשמר מנורמל', afterRealPush.products?.[0]?.kind, 'main');
  check('מחיר המוצר החדש', afterRealPush.products?.[0]?.price, '4000');
  check('מחיר הכרטיס עודכן', getVendorDisplayPrice(afterRealPush).display, '₪4,000');
  check('כרטיס עם חבילה אחת אינו "החל מ־"', getVendorDisplayPrice(afterRealPush).isFrom, false);
} finally {
  if (created) {
    const del = await vendors.deleteMany({ $or: [{ name: TEST_NAME }, { contact: TEST_PHONE }] });
    console.log(`\n[ניקוי] נמחקו ${del.deletedCount} מסמכי בדיקה`);
  }
  await client.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? '✗' : '✓'} ${results.length - failed.length}/${results.length} בדיקות עברו`);
process.exit(failed.length ? 1 : 0);
