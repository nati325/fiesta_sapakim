/**
 * Import מאפרות CSV → suppliers_complete.json (+ production CSV append)
 * Dedupes by normalized phone against existing records.
 *
 * Usage:
 *   node scripts/import-maparot-csv.mjs "C:\Users\123\Desktop\מאפרות מעודכן.csv"
 *   node scripts/import-maparot-csv.mjs "..." --force   # overwrite images/reviews on matches
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'data', 'suppliers_complete.json');
const CSV_PATH = path.join(ROOT, 'scraping', 'engaged_suppliers_final_production.csv');

const csvFile = process.argv[2];
const FORCE = process.argv.includes('--force');
if (!csvFile || !fs.existsSync(csvFile)) {
  console.error('Usage: node scripts/import-maparot-csv.mjs <path-to-csv> [--force]');
  process.exit(1);
}

function na(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s === 'N/A' || s === 'nan' || s === 'FAILED') return '';
  return s;
}

/** Convert absolute Windows / Fiesta paths → /media/suppliers/... */
function normalizeImagePath(raw) {
  const s = na(raw);
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  // Already web path
  if (s.startsWith('/media/')) return s.replace(/\\/g, '/');
  // Absolute Windows path containing media\suppliers\PHONE\file
  const m = s.replace(/\//g, '\\').match(/media\\suppliers\\([^\\]+)\\([^\\]+)$/i);
  if (m) return `/media/suppliers/${m[1]}/${m[2]}`;
  // Relative media\suppliers\...
  const m2 = s.replace(/\\/g, '/').match(/(?:^|\/)media\/suppliers\/([^/]+)\/([^/]+)$/i);
  if (m2) return `/media/suppliers/${m2[1]}/${m2[2]}`;
  return s;
}

function collectImages(row) {
  const images = [];
  const add = (raw) => {
    const img = normalizeImagePath(raw);
    if (img && !images.includes(img)) images.push(img);
  };
  add(row['תמונה ראשית']);
  const galleryRaw = na(row['גלריה']);
  if (galleryRaw) {
    galleryRaw.split(/[|,;]/).forEach(add);
  }
  return images;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}

function formatPhone(phone) {
  const d = normalizePhone(phone);
  if (!d) return '';
  if (d.length === 10 && d.startsWith('05')) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 9 && d.startsWith('0')) return `${d.slice(0, 2)}-${d.slice(2)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

function pickWebsite(row) {
  return (
    na(row['אתר / קישור מוביל']) ||
    na(row['אינסטגרם']) ||
    na(row['פייסבוק']) ||
    ''
  );
}

function parseReviewCount(easyRating, reviewCountCol) {
  const fromCol = na(reviewCountCol);
  if (fromCol && /^\d+$/.test(fromCol)) return fromCol;
  const text = na(easyRating);
  const m = text.match(/(\d+)\s*ביקורות/);
  return m ? m[1] : '';
}

function parseReviews(raw) {
  const text = na(raw);
  if (!text) return [];

  const blocks = text.split(/\n(?=\[)/).map((b) => b.trim()).filter(Boolean);
  const reviews = [];

  for (const block of blocks) {
    const m = block.match(/^\[([^\]]*?)\s*-\s*דירוג\s*(\d+(?:\.\d+)?)\s*\/\s*5\]\s*:?\s*([\s\S]*)$/);
    if (m) {
      const reviewer = m[1].trim();
      const rating = Number(m[2]);
      const body = m[3].trim();
      // Skip aggregate-only lines like "210 ביקורות"
      if (/^\d+\s*ביקורות\s*$/i.test(body)) continue;
      if (!body || body.length < 12) continue;
      if (
        /^(google maps|פייסבוק|mit4mit|facebook)\b/i.test(reviewer) &&
        body.length < 40 &&
        /ביקורות/.test(body)
      ) {
        continue;
      }
      reviews.push({
        reviewer: reviewer || 'לקוח מרוצה',
        rating: Number.isFinite(rating) ? rating : 5,
        text: body,
        source: '', // never expose Easy
      });
      continue;
    }
    if (block.length > 25 && !/^\d+\s*ביקורות/.test(block)) {
      reviews.push({
        reviewer: 'לקוח מרוצה',
        rating: 5,
        text: block,
        source: '',
      });
    }
  }

  return reviews.slice(0, 20);
}

function ensureMakeupSignal(name, description) {
  const hay = `${name} ${description}`.toLowerCase();
  if (/מאפר|איפור|makeup|mua/.test(hay)) return description;
  const prefix = 'מאפרת / איפור כלות ואירועים.';
  return description ? `${prefix} ${description}` : prefix;
}

function rowToSupplier(row, id) {
  const name = na(row['שם המאפרת']);
  const phone = formatPhone(row['טלפון נייד']);
  const address = na(row['כתובת']);
  const easyUrl = na(row['קישור איזי']);
  const website = pickWebsite(row);
  const description = ensureMakeupSignal(name, na(row['תיאור עסק']));
  const reviewsCount = parseReviewCount(row['דירוג איזי'], row['מספר חוות דעת']);
  const reviews = parseReviews(row['חוות דעת של לקוחות']);
  const images = collectImages(row);

  const cleanName = name.split('|')[0].trim();

  return {
    id,
    name,
    clean_name: cleanName,
    phone: null,
    real_phone: phone,
    category: 'לחתן ולכלה',
    website,
    address: address || null,
    // Keep Easy out of visible source fields
    engaged_url: null,
    easy_url_internal: easyUrl || null,
    images,
    reviews,
    google_rating: null,
    reviews_count: reviewsCount || null,
    description,
    portfolio: [],
    // Keep socials for enrichment / future use
    instagram: na(row['אינסטגרם']) || null,
    facebook: na(row['פייסבוק']) || null,
    source_import: 'maparot-csv-2026-07',
  };
}

function toProductionCsvRow(supplier) {
  return {
    'Supplier Name': supplier.name,
    'Phone Number': supplier.real_phone || '',
    Category: supplier.category,
    URL: '',
    'Main Image': supplier.images?.[0] || '',
    Gallery: (supplier.images || []).slice(1).join('|'),
    'Real Phone': supplier.real_phone || '',
    Website: supplier.website || '',
    'Google Reviews Link': '',
    'Google Image': '',
    'Google Rating': '',
    'Reviews Count': supplier.reviews_count || '',
    Address: supplier.address || '',
  };
}

const text = fs.readFileSync(csvFile, 'utf8');
const parsed = Papa.parse(text, {
  header: true,
  skipEmptyLines: true,
  dynamicTyping: false,
});

if (parsed.errors?.length) {
  console.warn('CSV parse warnings:', parsed.errors.slice(0, 5));
}

const rows = parsed.data.filter((r) => na(r['שם המאפרת']) && na(r['טלפון נייד']));
console.log(`CSV rows with name+phone: ${rows.length}`);

const existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const phoneIndex = new Map();
existing.forEach((s, idx) => {
  const key = normalizePhone(s.real_phone || s.phone);
  if (key) phoneIndex.set(key, idx);
});

let nextId = Math.max(0, ...existing.map((s) => Number(s.id) || 0)) + 1;
const added = [];
const enriched = [];
const skippedNoPhone = [];

for (const row of rows) {
  const phoneKey = normalizePhone(row['טלפון נייד']);
  if (!phoneKey) {
    skippedNoPhone.push(na(row['שם המאפרת']));
    continue;
  }

  if (phoneIndex.has(phoneKey)) {
    const idx = phoneIndex.get(phoneKey);
    const cur = existing[idx];
    let changed = false;

    const incoming = rowToSupplier(row, cur.id);

    if (FORCE || cur.source_import === 'maparot-csv-2026-07') {
      // Full refresh from expanded CSV for maparot imports
      if (incoming.images.length) {
        cur.images = incoming.images;
        changed = true;
      }
      cur.reviews = incoming.reviews;
      if (na(incoming.description)) cur.description = incoming.description;
      if (na(incoming.address)) cur.address = incoming.address;
      if (na(incoming.website)) cur.website = incoming.website;
      if (na(incoming.reviews_count)) cur.reviews_count = incoming.reviews_count;
      if (incoming.instagram) cur.instagram = incoming.instagram;
      if (incoming.facebook) cur.facebook = incoming.facebook;
      cur.engaged_url = null;
      if (incoming.easy_url_internal) cur.easy_url_internal = incoming.easy_url_internal;
      cur.source_import = 'maparot-csv-2026-07';
      changed = true;
      enriched.push(cur.name);
      continue;
    }

    // Enrich gaps only for non-maparot existing records
    if (!na(cur.description) && na(incoming.description)) {
      cur.description = incoming.description;
      changed = true;
    }
    if (!na(cur.address) && na(incoming.address)) {
      cur.address = incoming.address;
      changed = true;
    }
    if (!na(cur.website) && na(incoming.website)) {
      cur.website = incoming.website;
      changed = true;
    }
    if ((!cur.images || cur.images.length === 0) && incoming.images.length) {
      cur.images = incoming.images;
      changed = true;
    }
    if ((!cur.reviews || cur.reviews.length === 0) && incoming.reviews.length) {
      cur.reviews = incoming.reviews;
      changed = true;
    }
    if (!na(cur.reviews_count) && na(incoming.reviews_count)) {
      cur.reviews_count = incoming.reviews_count;
      changed = true;
    }
    // Ensure makeup signal for Moran grouping
    const hay = `${cur.name || ''} ${cur.description || ''}`.toLowerCase();
    if (!/מאפר|איפור|makeup|mua/.test(hay)) {
      cur.description = ensureMakeupSignal(cur.name || '', cur.description || '');
      changed = true;
    }
    if (changed) enriched.push(cur.name);
    continue;
  }

  const supplier = rowToSupplier(row, nextId++);
  existing.push(supplier);
  phoneIndex.set(phoneKey, existing.length - 1);
  added.push(supplier);
}

fs.writeFileSync(JSON_PATH, JSON.stringify(existing, null, 2), 'utf8');
console.log(`Wrote ${JSON_PATH}`);
console.log(`Total suppliers now: ${existing.length}`);
console.log(`Added: ${added.length}`);
console.log(`Enriched/updated existing: ${enriched.length}`);
if (skippedNoPhone.length) console.log(`Skipped no phone: ${skippedNoPhone.length}`);

// Sync production CSV: append new + update gallery/images for maparot phones
{
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const existingCsv = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const csvPhones = new Map();
  existingCsv.data.forEach((r, i) => {
    const key = normalizePhone(r['Real Phone'] || r['Phone Number']);
    if (key) csvPhones.set(key, i);
  });

  let csvUpdated = 0;
  for (const s of existing.filter((x) => x.source_import === 'maparot-csv-2026-07')) {
    const key = normalizePhone(s.real_phone);
    const row = toProductionCsvRow(s);
    if (csvPhones.has(key)) {
      const i = csvPhones.get(key);
      existingCsv.data[i] = { ...existingCsv.data[i], ...row };
      csvUpdated++;
    } else {
      existingCsv.data.push(row);
      csvPhones.set(key, existingCsv.data.length - 1);
    }
  }

  const out = Papa.unparse(existingCsv.data, { header: true });
  fs.writeFileSync(CSV_PATH, out.endsWith('\n') ? out : out + '\n', 'utf8');
  console.log(`Production CSV synced (updated/inserted maparot rows: ${csvUpdated + added.length})`);
}

console.log('\n--- Sample updated ---');
existing
  .filter((s) => s.source_import === 'maparot-csv-2026-07')
  .slice(0, 5)
  .forEach((s) => {
    console.log(
      `#${s.id} ${s.name} | ${s.real_phone} | imgs=${s.images?.length || 0} reviews=${s.reviews?.length || 0}`
    );
  });
