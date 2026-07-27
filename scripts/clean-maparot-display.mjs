/**
 * Clean imported מאפרות: keep real reviews only, strip Easy as visible source.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'data', 'suppliers_complete.json');
const CSV_FILE = process.argv[2] || 'C:\\Users\\123\\Desktop\\מאפרות מעודכן.csv';

function na(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s === 'N/A' || s === 'nan' || s === 'FAILED') return '';
  return s;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}

function isEasyUrl(url) {
  return /easy\.co\.il/i.test(String(url || ''));
}

function parseRealReviews(raw) {
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
      // Skip aggregate-only lines
      if (/^\d+\s*ביקורות\s*$/i.test(body)) continue;
      if (!body || body.length < 12) continue;
      // Skip source-name aggregates like "google maps - 149 ביקורות" style short
      if (/^(google maps|פייסבוק|mit4mit|facebook)\b/i.test(reviewer) && body.length < 40 && /ביקורות/.test(body)) {
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

  return reviews.slice(0, 12);
}

const csvText = fs.readFileSync(CSV_FILE, 'utf8');
const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;
const byPhone = new Map();
for (const row of rows) {
  const key = normalizePhone(row['טלפון נייד']);
  if (key) byPhone.set(key, row);
}

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
let cleaned = 0;
let reviewsFixed = 0;
let easyStripped = 0;

for (const s of data) {
  const isImport = s.source_import === 'maparot-csv-2026-07';
  const phoneKey = normalizePhone(s.real_phone || s.phone);
  const csvRow = phoneKey ? byPhone.get(phoneKey) : null;
  if (!isImport && !csvRow) continue;

  let changed = false;

  if (isEasyUrl(s.engaged_url)) {
    s.engaged_url = null;
    easyStripped++;
    changed = true;
  }

  if (csvRow) {
    const real = parseRealReviews(csvRow['חוות דעת של לקוחות']);
    const prev = Array.isArray(s.reviews) ? s.reviews : [];
    const prevReal = prev.filter(
      (r) => r?.text && !/^\d+\s*ביקורות\s*$/i.test(String(r.text).trim())
    );
    // Prefer freshly parsed real reviews from CSV
    if (real.length) {
      s.reviews = real;
      reviewsFixed++;
      changed = true;
    } else if (prevReal.length !== prev.length) {
      s.reviews = prevReal.map((r) => ({
        ...r,
        source: isEasyUrl(r.source) ? '' : r.source || '',
      }));
      reviewsFixed++;
      changed = true;
    } else if (prev.some((r) => isEasyUrl(r.source))) {
      s.reviews = prev.map((r) => ({
        ...r,
        source: isEasyUrl(r.source) ? '' : r.source || '',
      }));
      easyStripped++;
      changed = true;
    }
  } else if (Array.isArray(s.reviews) && s.reviews.length) {
    const next = s.reviews
      .filter((r) => r?.text && !/^\d+\s*ביקורות\s*$/i.test(String(r.text).trim()))
      .map((r) => ({ ...r, source: isEasyUrl(r.source) ? '' : r.source || '' }));
    if (JSON.stringify(next) !== JSON.stringify(s.reviews)) {
      s.reviews = next;
      reviewsFixed++;
      changed = true;
    }
  }

  if (changed) cleaned++;
}

fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf8');

const imported = data.filter((s) => s.source_import === 'maparot-csv-2026-07');
const withReal = imported.filter((s) => s.reviews?.length);
const stillEasy = imported.filter(
  (s) => isEasyUrl(s.engaged_url) || (s.reviews || []).some((r) => isEasyUrl(r.source))
);

console.log({
  cleanedSuppliers: cleaned,
  reviewsFixed,
  easyStripped,
  imported: imported.length,
  withRealReviews: withReal.length,
  totalRealReviewItems: withReal.reduce((a, s) => a + s.reviews.length, 0),
  stillShowingEasy: stillEasy.length,
  galleriesInCsv: 0,
  note: 'CSV gallery column was all N/A — only main thumbnails exist',
});
