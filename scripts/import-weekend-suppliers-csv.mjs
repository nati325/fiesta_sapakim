/**
 * Import "ספקים סוף השבוע.csv" → suppliers_complete.json (+ production CSV)
 * Dedupes by normalized phone. Normalizes categories to Hebrew for agent feeds.
 *
 * Usage:
 *   node scripts/import-weekend-suppliers-csv.mjs "C:\Users\123\Desktop\ספקים סוף השבוע.csv"
 *   node scripts/import-weekend-suppliers-csv.mjs "..." --force
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'data', 'suppliers_complete.json');
const CSV_PATH = path.join(ROOT, 'scraping', 'engaged_suppliers_final_production.csv');
const FIESTA_MEDIA = path.resolve(ROOT, '..', 'Fiesta', 'fiesta-nextjs', 'public', 'media', 'suppliers');
const LOCAL_MEDIA = path.join(ROOT, 'public', 'media', 'suppliers');

const SOURCE_TAG = 'weekend-csv-2026-08';
const csvFile = process.argv[2];
const FORCE = process.argv.includes('--force');

if (!csvFile || !fs.existsSync(csvFile)) {
  console.error('Usage: node scripts/import-weekend-suppliers-csv.mjs <path-to-csv> [--force]');
  process.exit(1);
}

/** CSV category (Hebrew or Fiesta slug) → Hebrew label for dashboard agent filters */
const CATEGORY_NORMALIZE = {
  venue: 'אולמות וגנים',
  'אולמות וגנים': 'אולמות וגנים',
  photographer: 'צילום',
  צלמים: 'צילום',
  dj: 'מוזיקה',
  'דיג`יי': 'מוזיקה',
  'דיגיי': 'מוזיקה',
  מוזיקה: 'מוזיקה',
  makeup: 'איפור',
  'איפור כלות': 'איפור',
  hair: 'עיצוב שיער',
  dresses: 'שמלות כלה',
  suits: 'חליפות חתן',
  catering: 'קייטרינג',
  design: 'עיצוב אירועים',
  rings: 'טבעות נישואין',
  invitations: 'הזמנות',
  attractions: 'אטרקציות',
  אטרקציות: 'אטרקציות',
  'event-production': 'הפקת אירועים',
  'ארגון חתונה': 'ארגון חתונה',
  alcohol: 'אלכוהול ובר',
  rabbi: 'רב לחופה',
  bachelor: 'מסיבות רווקים',
  hotels: 'מלונות',
  singers: 'זמרים ולהקות',
  arrivals: 'הסעות',
  challa: 'הפרשת חלה',
  'לחתן ולכלה': 'לחתן ולכלה',
};

function na(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s === 'N/A' || s === 'nan' || s === 'FAILED') return '';
  return s;
}

function normalizeCategory(raw) {
  const s = na(raw);
  if (!s) return 'ספקים ללא קטגוריה';
  if (CATEGORY_NORMALIZE[s]) return CATEGORY_NORMALIZE[s];
  const lower = s.toLowerCase();
  if (CATEGORY_NORMALIZE[lower]) return CATEGORY_NORMALIZE[lower];
  return s;
}

function normalizeImagePath(raw) {
  const s = na(raw);
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/media/')) return s.replace(/\\/g, '/');
  const normalized = s.replace(/\\/g, '/');
  const m = normalized.match(/(?:^|\/)media\/suppliers\/([^/]+)\/([^/]+)$/i);
  if (m) return `/media/suppliers/${m[1]}/${m[2]}`;
  return s;
}

function imageFolderFromPath(raw) {
  const web = normalizeImagePath(raw);
  const m = web.match(/^\/media\/suppliers\/([^/]+)\//);
  return m ? m[1] : '';
}

function collectImages(row) {
  const images = [];
  const add = (raw) => {
    const img = normalizeImagePath(raw);
    if (img && !images.includes(img)) images.push(img);
  };
  add(row['תמונה ראשית']);
  const galleryRaw = na(row['גלריה']);
  if (galleryRaw) galleryRaw.split(/[|,;]/).forEach(add);
  return images;
}

function formatFromDigits(digits) {
  if (!digits) return '';
  let d = digits;
  if (d.startsWith('972') && d.length >= 11) d = '0' + d.slice(3);
  if (d.length === 10 && d.startsWith('05')) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 9 && d.startsWith('0')) return `${d.slice(0, 2)}-${d.slice(2)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

function extractPrimaryPhone(raw) {
  const s = na(raw);
  if (!s) return '';

  const parts = s.split(/[,;|/]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const digits = part.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 12) return formatFromDigits(digits);
  }

  const digits = s.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length >= 9 && digits.length <= 12) return formatFromDigits(digits);

  const mobile = digits.match(/05\d{8}/);
  if (mobile) return formatFromDigits(mobile[0]);

  if (digits.startsWith('972')) {
    const local = '0' + digits.slice(3);
    if (local.length >= 9 && local.length <= 12) return formatFromDigits(local);
  }

  if (digits.startsWith('0')) return formatFromDigits(digits.slice(0, 10));

  return formatFromDigits(digits.slice(0, 10));
}

function normalizePhone(phone) {
  return extractPrimaryPhone(phone).replace(/\D/g, '');
}

function formatPhone(phone) {
  return extractPrimaryPhone(phone);
}

function pickWebsite(row) {
  return na(row['אתר / קישור מוביל']) || na(row['אינסטגרם']) || na(row['פייסבוק']) || '';
}

function pickEngagedUrl(row) {
  const url = na(row['קישור איזי']);
  if (!url) return null;
  if (/engaged\.co\.il/i.test(url)) return url;
  return null;
}

function pickEasyUrlInternal(row) {
  const url = na(row['קישור איזי']);
  if (!url) return null;
  if (/easy/i.test(url) || /mit4mit/i.test(url)) return url;
  return null;
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
        source: '',
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

function recordScore(s) {
  let points = 0;
  if (na(s.description)) points += 3;
  if (s.images?.length) points += s.images.length * 2;
  if (s.reviews?.length) points += s.reviews.length;
  if (na(s.address)) points += 1;
  if (na(s.website)) points += 1;
  return points;
}

function rowToSupplier(row, id) {
  const name = na(row['שם הספק']);
  const phone = formatPhone(row['טלפון נייד']);
  const address = na(row['כתובת']);
  const website = pickWebsite(row);
  const description = na(row['תיאור עסק']);
  const reviewsCount = parseReviewCount(row['דירוג איזי'], row['מספר חוות דעת']);
  const reviews = parseReviews(row['חוות דעת של לקוחות']);
  const images = collectImages(row);
  const category = normalizeCategory(row['קטגוריה']);
  const cleanName = name.split('|')[0].trim();

  return {
    id,
    name,
    clean_name: cleanName,
    phone: null,
    real_phone: phone,
    category,
    website: website || null,
    address: address || null,
    engaged_url: pickEngagedUrl(row),
    easy_url_internal: pickEasyUrlInternal(row),
    images,
    reviews,
    google_rating: na(row['דירוג איזי']) || null,
    reviews_count: reviewsCount || null,
    description: description || null,
    portfolio: [],
    instagram: na(row['אינסטגרם']) || null,
    facebook: na(row['פייסבוק']) || null,
    source_import: SOURCE_TAG,
  };
}

function toProductionCsvRow(supplier) {
  return {
    'Supplier Name': supplier.name,
    'Phone Number': supplier.real_phone || '',
    Category: supplier.category,
    URL: supplier.engaged_url || '',
    'Main Image': supplier.images?.[0] || '',
    Gallery: (supplier.images || []).slice(1).join('|'),
    'Real Phone': supplier.real_phone || '',
    Website: supplier.website || '',
    'Google Reviews Link': '',
    'Google Image': '',
    'Google Rating': supplier.google_rating || '',
    'Reviews Count': supplier.reviews_count || '',
    Address: supplier.address || '',
  };
}

function mergeSupplier(existing, incoming, force) {
  const shouldRefresh =
    force ||
    existing.source_import === SOURCE_TAG ||
    recordScore(incoming) > recordScore(existing);

  if (!shouldRefresh && existing.source_import !== SOURCE_TAG) {
    let changed = false;
    if (!na(existing.description) && na(incoming.description)) {
      existing.description = incoming.description;
      changed = true;
    }
    if (!na(existing.address) && na(incoming.address)) {
      existing.address = incoming.address;
      changed = true;
    }
    if (!na(existing.website) && na(incoming.website)) {
      existing.website = incoming.website;
      changed = true;
    }
    if ((!existing.images || existing.images.length === 0) && incoming.images.length) {
      existing.images = incoming.images;
      changed = true;
    }
    if ((!existing.reviews || existing.reviews.length === 0) && incoming.reviews.length) {
      existing.reviews = incoming.reviews;
      changed = true;
    }
    if (!na(existing.reviews_count) && na(incoming.reviews_count)) {
      existing.reviews_count = incoming.reviews_count;
      changed = true;
    }
    if (!na(existing.category) && na(incoming.category)) {
      existing.category = incoming.category;
      changed = true;
    }
    return changed ? 'enriched-gap' : 'skipped';
  }

  existing.name = incoming.name || existing.name;
  existing.clean_name = incoming.clean_name || existing.clean_name;
  existing.category = incoming.category || existing.category;
  if (na(incoming.description)) existing.description = incoming.description;
  if (na(incoming.address)) existing.address = incoming.address;
  if (na(incoming.website)) existing.website = incoming.website;
  if (incoming.images.length) existing.images = incoming.images;
  if (incoming.reviews.length) existing.reviews = incoming.reviews;
  if (na(incoming.reviews_count)) existing.reviews_count = incoming.reviews_count;
  if (na(incoming.google_rating)) existing.google_rating = incoming.google_rating;
  if (incoming.engaged_url) existing.engaged_url = incoming.engaged_url;
  if (incoming.easy_url_internal) existing.easy_url_internal = incoming.easy_url_internal;
  if (incoming.instagram) existing.instagram = incoming.instagram;
  if (incoming.facebook) existing.facebook = incoming.facebook;
  existing.source_import = SOURCE_TAG;
  return shouldRefresh && existing.id !== incoming.id ? 'updated' : 'enriched';
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, dstPath);
    else if (!fs.existsSync(dstPath)) fs.copyFileSync(srcPath, dstPath);
  }
}

function syncMediaFolders(rows) {
  const folders = new Set();
  for (const row of rows) {
    const folder = imageFolderFromPath(row['תמונה ראשית']);
    if (folder) folders.add(folder);
  }

  let copied = 0;
  let missing = 0;
  for (const folder of folders) {
    const src = path.join(FIESTA_MEDIA, folder);
    const dst = path.join(LOCAL_MEDIA, folder);
    if (!fs.existsSync(src)) {
      missing++;
      continue;
    }
    if (!fs.existsSync(dst)) {
      copyDirRecursive(src, dst);
      copied++;
    }
  }
  return { folders: folders.size, copied, missing };
}

// ── Parse CSV ────────────────────────────────────────────────────────────────
const text = fs.readFileSync(csvFile, 'utf8');
const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
if (parsed.errors?.length) {
  console.warn('CSV parse warnings:', parsed.errors.slice(0, 5));
}

const rawRows = parsed.data.filter((r) => na(r['שם הספק']) && na(r['טלפון נייד']));
console.log(`CSV rows with name+phone: ${rawRows.length}`);

// Dedupe CSV by phone — keep richest row
const csvByPhone = new Map();
for (const row of rawRows) {
  const key = normalizePhone(row['טלפון נייד']);
  if (!key) continue;
  const prev = csvByPhone.get(key);
  if (!prev) {
    csvByPhone.set(key, row);
    continue;
  }
  const prevScore =
    collectImages(prev).length +
    parseReviews(prev['חוות דעת של לקוחות']).length +
    (na(prev['תיאור עסק']) ? 5 : 0);
  const curScore =
    collectImages(row).length +
    parseReviews(row['חוות דעת של לקוחות']).length +
    (na(row['תיאור עסק']) ? 5 : 0);
  if (curScore >= prevScore) csvByPhone.set(key, row);
}
const rows = Array.from(csvByPhone.values());
console.log(`Unique phones in CSV: ${rows.length}`);

// ── Load existing JSON ───────────────────────────────────────────────────────
const existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

// Normalize phones on all existing records before merge
for (const s of existing) {
  const fixed = extractPrimaryPhone(s.real_phone || s.phone);
  if (fixed) {
    s.real_phone = fixed;
    s.phone = fixed;
  }
}

const phoneIndex = new Map();
existing.forEach((s, idx) => {
  const key = normalizePhone(s.real_phone || s.phone);
  if (key) phoneIndex.set(key, idx);
});

let nextId = Math.max(0, ...existing.map((s) => Number(s.id) || 0)) + 1;
const added = [];
const updated = [];
const enriched = [];
const skipped = [];

for (const row of rows) {
  const phoneKey = normalizePhone(row['טלפון נייד']);
  const incoming = rowToSupplier(row, nextId);

  if (phoneIndex.has(phoneKey)) {
    const idx = phoneIndex.get(phoneKey);
    const cur = existing[idx];
    incoming.id = cur.id;
    const result = mergeSupplier(cur, incoming, FORCE);
    if (result === 'skipped') skipped.push(cur.name);
    else if (result === 'updated') updated.push(cur.name);
    else enriched.push(cur.name);
    continue;
  }

  incoming.id = nextId++;
  existing.push(incoming);
  phoneIndex.set(phoneKey, existing.length - 1);
  added.push(incoming);
}

fs.writeFileSync(JSON_PATH, JSON.stringify(existing, null, 2), 'utf8');

// ── Final dedupe by phone (keep richest record) ──────────────────────────────
{
  const byPhone = new Map();
  for (const s of existing) {
    const key = normalizePhone(s.real_phone || s.phone);
    if (!key || key.length < 9) continue;
    const prev = byPhone.get(key);
    if (!prev || recordScore(s) > recordScore(prev)) byPhone.set(key, s);
  }
  const deduped = Array.from(byPhone.values()).sort((a, b) => (a.id || 0) - (b.id || 0));
  const removed = existing.length - deduped.length;
  if (removed > 0) {
    deduped.forEach((s, i) => {
      s.id = i + 1;
    });
    fs.writeFileSync(JSON_PATH, JSON.stringify(deduped, null, 2), 'utf8');
    console.log(`Deduped by phone: removed ${removed} duplicates, total ${deduped.length}`);
    existing.length = 0;
    existing.push(...deduped);
  }
}

// ── Sync production CSV ──────────────────────────────────────────────────────
{
  let csvData = [];
  if (fs.existsSync(CSV_PATH)) {
    const csvText = fs.readFileSync(CSV_PATH, 'utf8');
    csvData = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;
  }
  const csvPhones = new Map();
  csvData.forEach((r, i) => {
    const key = normalizePhone(r['Real Phone'] || r['Phone Number']);
    if (key) csvPhones.set(key, i);
  });

  let csvInserted = 0;
  let csvUpdated = 0;
  for (const s of existing.filter((x) => x.source_import === SOURCE_TAG)) {
    const key = normalizePhone(s.real_phone);
    const row = toProductionCsvRow(s);
    if (csvPhones.has(key)) {
      csvData[csvPhones.get(key)] = { ...csvData[csvPhones.get(key)], ...row };
      csvUpdated++;
    } else {
      csvData.push(row);
      csvPhones.set(key, csvData.length - 1);
      csvInserted++;
    }
  }

  const out = Papa.unparse(csvData, { header: true });
  fs.writeFileSync(CSV_PATH, out.endsWith('\n') ? out : out + '\n', 'utf8');
  console.log(`Production CSV: inserted ${csvInserted}, updated ${csvUpdated}`);
}

// ── Copy media from Fiesta project ───────────────────────────────────────────
const mediaStats = syncMediaFolders(rows);

// ── Report ───────────────────────────────────────────────────────────────────
const categories = {};
for (const s of existing.filter((x) => x.source_import === SOURCE_TAG)) {
  categories[s.category] = (categories[s.category] || 0) + 1;
}

console.log('\n=== Import complete ===');
console.log(`JSON: ${JSON_PATH}`);
console.log(`Total suppliers now: ${existing.length}`);
console.log(`Added: ${added.length}`);
console.log(`Updated (force/richer): ${updated.length}`);
console.log(`Enriched existing: ${enriched.length}`);
console.log(`Skipped (already complete): ${skipped.length}`);
console.log(`Weekend import total: ${existing.filter((x) => x.source_import === SOURCE_TAG).length}`);
console.log(`Media folders referenced: ${mediaStats.folders}, copied: ${mediaStats.copied}, missing source: ${mediaStats.missing}`);

console.log('\nCategories in weekend import:');
Object.entries(categories)
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, n]) => console.log(`  ${n}\t${cat}`));

console.log('\n--- Sample new suppliers ---');
added.slice(0, 5).forEach((s) => {
  console.log(`  #${s.id} ${s.name} | ${s.category} | ${s.real_phone} | imgs=${s.images?.length || 0} reviews=${s.reviews?.length || 0}`);
});
