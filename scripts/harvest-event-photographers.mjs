/**
 * Harvest event photographers from mit4mit and import unique ones into the CRM.
 *
 * Dedupes against existing JSON + production CSV + Mongo phones (and names).
 *
 * Usage:
 *   node scripts/harvest-event-photographers.mjs --limit 400
 *   node scripts/harvest-event-photographers.mjs --limit 20 --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { phoneKey, formatPhoneDisplay } from '../lib/phoneUtils.js';
import { cleanDescription } from '../lib/cleanDescription.js';
import { jsonItemToMongoDoc, bulkUpsertSuppliers, countSuppliersInMongo } from '../lib/suppliersMongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'data', 'suppliers_complete.json');
const CSV_PATH = path.join(ROOT, 'scraping', 'engaged_suppliers_final_production.csv');
const HARVEST_PATH = path.join(ROOT, 'data', 'harvest-photographers-2026-08.json');

const SOURCE_TAG = 'mit4mit-photographers-2026-08';
const CATEGORY = 'צילום';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const LISTING_SOURCES = [
  { name: 'category-11', url: (page) => `https://www.mit4mit.co.il/category/11?page=${page}`, maxPages: 91 },
  { name: 'top-photo', url: (page) => `https://www.mit4mit.co.il/top/54719c753be563f2f3059220/?page=${page}`, maxPages: 100 },
];

const EXCLUDE_RE =
  /דרכון|פספורט|passport|תעודת זהות|מעבדת\s*צילום|חנות מצלמ|הדפסת תמונ|photo lab|camera store/i;
const NAME_STRIP_RE =
  /צלמ[תם]?|צילום|photographer|photography|video|וידאו|studio|סטודיו|אירועים|חתונות|wedding|events?/gi;

const args = process.argv.slice(2);
const LIMIT = Math.max(1, Number(argValue('--limit', '400')) || 400);
const DRY_RUN = args.includes('--dry-run');
const DELAY_MS = Math.max(200, Number(argValue('--delay', '450')) || 450);

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function asList(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function isTrackingPhone(digits) {
  return digits.startsWith('07239') || digits.startsWith('072392') || digits.startsWith('07393');
}

function normalizeDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('972') && d.length >= 11) d = `0${d.slice(3)}`;
  if (d.startsWith('97') && d.length >= 11) d = `0${d.slice(3)}`;
  return d;
}

function pickBestPhone(biz) {
  const candidates = [...asList(biz.Phones), ...asList(biz.whatsapp), ...asList(biz.contactPhone)]
    .map(normalizeDigits)
    .filter((d) => d.length >= 9 && d.length <= 11 && !isTrackingPhone(d));

  const mobile = candidates.find((d) => d.length === 10 && d.startsWith('05'));
  if (mobile) return mobile;
  const landline = candidates.find((d) => d.startsWith('0') && (d.length === 9 || d.length === 10));
  return landline || '';
}

function nameKey(name) {
  const cleaned = String(name || '')
    .split('|')[0]
    .toLowerCase()
    .replace(/[״"'`.,()\-/\\]/g, ' ')
    .replace(NAME_STRIP_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 4 ? cleaned : '';
}

function cleanUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s === 'nan' || s === 'N/A') return '';
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/i.test(url.protocol)) return '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return s.split('?')[0];
  }
}

function imageUrls(bizId, gallery) {
  const n = Math.min(5, Math.max(1, Array.isArray(gallery) ? gallery.length : 1));
  const urls = [];
  for (let i = 1; i <= n; i++) {
    urls.push(`https://bucket2.mit4mit.co.il/uploads/biz/${bizId}/big/${i}.jpg`);
  }
  return urls;
}

function shouldSkipBusiness(biz, text) {
  if (EXCLUDE_RE.test(text)) return true;
  if (biz.Mark_As_Hidden === 1 || biz.showInMit4Mit === false) return true;
  return false;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseBizList(html) {
  const match = html.match(/var data_for_map = (\[[\s\S]*?\]);\s*\n/);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function bizToSupplier(biz, id) {
  const digits = pickBestPhone(biz);
  const phone = formatPhoneDisplay(digits) || digits;
  const name = String(biz.Name || '').trim();
  const images = imageUrls(biz.id, biz.businessImageArray2 || biz.businessImageArray3 || biz.firstGallery);
  const website = cleanUrl(biz.Website);
  const instagram = cleanUrl(biz.instagram);
  const facebook = cleanUrl(biz.facebook);
  const description = cleanDescription(biz.Description || '');

  return {
    id,
    name,
    clean_name: name.split('|')[0].trim() || name,
    phone,
    real_phone: phone,
    category: CATEGORY,
    website: website || null,
    address: String(biz.Address || '').trim() || null,
    engaged_url: null,
    easy_url_internal: `https://www.mit4mit.co.il/biz/${biz.id}`,
    images,
    reviews: [],
    google_rating: null,
    reviews_count: biz.number_of_reviews ? String(biz.number_of_reviews) : null,
    description: description || null,
    portfolio: [],
    instagram: instagram || null,
    facebook: facebook || null,
    source_import: SOURCE_TAG,
    mit4mit_id: biz.id,
    service_area: biz.service_area || null,
  };
}

function toCsvRow(supplier) {
  return {
    'Supplier Name': supplier.name,
    'Phone Number': supplier.real_phone || '',
    Category: supplier.category,
    URL: supplier.easy_url_internal || '',
    'Main Image': supplier.images?.[0] || '',
    Gallery: (supplier.images || []).slice(1).join('|'),
    'Real Phone': supplier.real_phone || '',
    Website: supplier.website || '',
    'Google Reviews Link': supplier.easy_url_internal || '',
    'Google Image': '',
    'Google Rating': supplier.google_rating || '',
    'Reviews Count': supplier.reviews_count || '',
    Address: supplier.address || '',
  };
}

function loadExisting() {
  const phones = new Set();
  const names = new Set();

  const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  for (const s of json) {
    const key = phoneKey(s.real_phone || s.phone);
    if (key) phones.add(key);
    const nk = nameKey(s.name || s.clean_name || s['Supplier Name']);
    if (nk) names.add(nk);
  }

  if (fs.existsSync(CSV_PATH)) {
    const csv = Papa.parse(fs.readFileSync(CSV_PATH, 'utf8'), { header: true, skipEmptyLines: true }).data;
    for (const row of csv) {
      const key = phoneKey(row['Real Phone'] || row['Phone Number']);
      if (key) phones.add(key);
      const nk = nameKey(row['Supplier Name']);
      if (nk) names.add(nk);
    }
  }

  return { json, phones, names };
}

async function addMongoPhones(phones) {
  if (!process.env.MONGODB_URI) return 0;
  try {
    const { getSuppliersCollection } = await import('../lib/suppliersMongo.js');
    const col = await getSuppliersCollection();
    const docs = await col.find({}, { projection: { phoneKey: 1, real_phone: 1, phone: 1 } }).toArray();
    let added = 0;
    for (const doc of docs) {
      const key = doc.phoneKey || phoneKey(doc.real_phone || doc.phone);
      if (key && !phones.has(key)) {
        phones.add(key);
        added++;
      }
    }
    return added;
  } catch (err) {
    console.warn('Mongo phone load skipped:', err.message);
    return 0;
  }
}

async function crawlUntilLimit({ phones, names }) {
  const harvested = [];
  const seenPhones = new Set();
  const seenNames = new Set();
  const seenBiz = new Set();
  const stats = { pages: 0, rows: 0, skippedPhone: 0, skippedName: 0, skippedJunk: 0, skippedNoPhone: 0 };

  for (const source of LISTING_SOURCES) {
    if (harvested.length >= LIMIT) break;
    console.log(`\nSource ${source.name}`);

    for (let page = 1; page <= source.maxPages && harvested.length < LIMIT; page++) {
      const url = source.url(page);
      let html;
      try {
        html = await fetchHtml(url);
      } catch (err) {
        console.warn(`  page ${page} failed: ${err.message}`);
        await sleep(DELAY_MS * 2);
        continue;
      }

      const list = parseBizList(html);
      stats.pages++;
      if (!list.length) {
        console.log(`  page ${page}: empty, stopping this source`);
        break;
      }

      let pageNew = 0;
      for (const biz of list) {
        stats.rows++;
        if (!biz?.id || seenBiz.has(biz.id)) continue;
        seenBiz.add(biz.id);

        const name = String(biz.Name || '').trim();
        const blob = `${name} ${biz.Description || ''} ${biz.english_name || ''}`;
        if (!name || shouldSkipBusiness(biz, blob)) {
          stats.skippedJunk++;
          continue;
        }

        const digits = pickBestPhone(biz);
        if (!digits) {
          stats.skippedNoPhone++;
          continue;
        }
        if (phones.has(digits) || seenPhones.has(digits)) {
          stats.skippedPhone++;
          continue;
        }

        const nk = nameKey(name);
        if (nk && (names.has(nk) || seenNames.has(nk))) {
          stats.skippedName++;
          continue;
        }

        harvested.push(bizToSupplier(biz, 0));
        seenPhones.add(digits);
        if (nk) seenNames.add(nk);
        pageNew++;
        if (harvested.length >= LIMIT) break;
      }

      console.log(
        `  page ${page}: +${pageNew} new  total ${harvested.length}/${LIMIT}  (skip phone=${stats.skippedPhone} name=${stats.skippedName} nophone=${stats.skippedNoPhone})`
      );
      await sleep(DELAY_MS);
    }
  }

  return { harvested, stats };
}

loadEnv();

const existing = loadExisting();
console.log(`Existing JSON: ${existing.json.length}`);
console.log(`Existing unique phones: ${existing.phones.size}`);
console.log(`Existing name keys: ${existing.names.size}`);
console.log(`Target: ${LIMIT} new photographers  dryRun=${DRY_RUN}`);

const extraMongo = await addMongoPhones(existing.phones);
if (extraMongo) console.log(`Extra phones from Mongo: ${extraMongo}`);

const { harvested, stats } = await crawlUntilLimit(existing);
console.log('\nCrawl stats', stats);
console.log(`Harvested: ${harvested.length}`);

if (!harvested.length) {
  console.error('No new photographers found.');
  process.exit(1);
}

let nextId = Math.max(0, ...existing.json.map((s) => Number(s.id) || 0)) + 1;
for (const s of harvested) s.id = nextId++;

fs.mkdirSync(path.dirname(HARVEST_PATH), { recursive: true });
fs.writeFileSync(HARVEST_PATH, JSON.stringify(harvested, null, 2), 'utf8');
console.log(`Wrote preview: ${HARVEST_PATH}`);

if (DRY_RUN) {
  console.log('\nDry run — not writing CRM. Sample:');
  harvested.slice(0, 8).forEach((s) => {
    console.log(`  ${s.real_phone}  ${s.name}  ${s.address || ''}`);
  });
  process.exit(0);
}

existing.json.push(...harvested);
fs.writeFileSync(JSON_PATH, JSON.stringify(existing.json, null, 2), 'utf8');
console.log(`JSON now: ${existing.json.length} (+${harvested.length})`);

{
  let csvData = [];
  if (fs.existsSync(CSV_PATH)) {
    csvData = Papa.parse(fs.readFileSync(CSV_PATH, 'utf8'), { header: true, skipEmptyLines: true }).data;
  }
  const csvPhones = new Set();
  for (const row of csvData) {
    const key = phoneKey(row['Real Phone'] || row['Phone Number']);
    if (key) csvPhones.add(key);
  }
  let inserted = 0;
  for (const s of harvested) {
    const key = phoneKey(s.real_phone);
    if (!key || csvPhones.has(key)) continue;
    csvData.push(toCsvRow(s));
    csvPhones.add(key);
    inserted++;
  }
  const out = Papa.unparse(csvData, { header: true });
  fs.writeFileSync(CSV_PATH, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
  console.log(`CSV inserted: ${inserted}`);
}

if (process.env.MONGODB_URI) {
  const docs = harvested.map(jsonItemToMongoDoc).filter(Boolean);
  const result = await bulkUpsertSuppliers(docs);
  const total = await countSuppliersInMongo();
  console.log(`Mongo upserted=${result.upserted} modified=${result.modified} total=${total}`);
} else {
  console.warn('MONGODB_URI missing — skipped Mongo import');
}

console.log('\n=== Harvest complete ===');
console.log(`New photographers: ${harvested.length}`);
console.log(`Source tag: ${SOURCE_TAG}`);
console.log('Sample:');
harvested.slice(0, 8).forEach((s) => {
  console.log(`  #${s.id} ${s.name} | ${s.real_phone} | ${s.address || ''}`);
});
process.exit(0);
