/**
 * Download maparot images using recoverable Easy thumbs + website/Instagram OG.
 * (Serper credits exhausted — not used.)
 *
 * Usage: node scripts/download-maparot-images.mjs [--limit N] [--force]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'data', 'suppliers_complete.json');
const IMAGES_MAP_PATH = path.join(ROOT, 'data', 'supplier_images.json');
const MEDIA_ROOT = path.join(ROOT, 'public', 'media', 'suppliers');
const DESKTOP_CSV = 'C:\\Users\\123\\Desktop\\מאפרות מעודכן.csv';
const MAX_IMAGES = 5;
const MIN_BYTES = 3500;
const FORCE = process.argv.includes('--force');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) || 0 : 0;
})();

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
};

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

function formatPhone(phone) {
  const d = normalizePhone(phone);
  if (!d) return '';
  if (d.length === 10 && d.startsWith('05')) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 9 && d.startsWith('0')) return `${d.slice(0, 2)}-${d.slice(2)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

function phoneFolder(phone) {
  return formatPhone(phone) || String(phone || '').trim();
}

function isBadImageUrl(url) {
  if (!url || !String(url).startsWith('http')) return true;
  const value = String(url).toLowerCase();
  if (value.endsWith('.svg')) return true;
  return /app.?store|play\.google|play-badge|google.?play|badge|mzstatic|favicon|sprite|pixel|logo_new|staticlogo|category\/ip\d|[-_/]logo[-_./]|[-_/]icon[-_./]|wixstatic\.com\/.*\.png/.test(
    value
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadLegacyEasyByPhone() {
  const map = new Map();
  try {
    const csv = execSync('git show d691124:scraping/engaged_suppliers_final_production.csv', {
      encoding: 'utf8',
      maxBuffer: 80 * 1024 * 1024,
    });
    const rows = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
    for (const row of rows) {
      const key = normalizePhone(row['Real Phone'] || row['Phone Number']);
      const main = na(row['Main Image']);
      if (key && main.includes('easy.co.il')) map.set(key, main);
    }
  } catch (err) {
    console.warn('Could not load legacy Easy URLs:', err.message);
  }
  return map;
}

function loadDesktopCsvByPhone() {
  if (!fs.existsSync(DESKTOP_CSV)) return new Map();
  const rows = Papa.parse(fs.readFileSync(DESKTOP_CSV, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  }).data;
  const map = new Map();
  for (const row of rows) {
    const key = normalizePhone(row['טלפון נייד']);
    if (key) map.set(key, row);
  }
  return map;
}

async function fetchBuffer(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        Referer: /easy\.co\.il|instagram|facebook/i.test(url)
          ? 'https://www.google.com/'
          : new URL(url).origin + '/',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (ctype && !/image|octet-stream/i.test(ctype) && !/\.(jpe?g|png|webp)(\?|$)/i.test(url)) {
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractOgImage(html) {
  if (!html) return null;
  const match =
    html.match(/property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
  const url = match?.[1]?.trim()?.replace(/&amp;/g, '&');
  return url && url.startsWith('http') && !isBadImageUrl(url) ? url : null;
}

function extractPageImages(html, baseUrl) {
  if (!html) return [];
  const found = new Set();
  const re = /(?:src|data-src|content)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let url = m[1].replace(/&amp;/g, '&');
    if (url.startsWith('//')) url = 'https:' + url;
    else if (url.startsWith('/') && baseUrl) {
      try {
        url = new URL(url, baseUrl).href;
      } catch {
        continue;
      }
    }
    if (!isBadImageUrl(url)) found.add(url);
  }
  return [...found];
}

async function collectCandidateUrls(supplier, csvRow, legacyEasyUrl) {
  const urls = [];
  const push = (u) => {
    if (u && !isBadImageUrl(u) && !urls.includes(u)) urls.push(u);
  };

  push(legacyEasyUrl);

  const website =
    na(csvRow?.['אתר / קישור מוביל']) || na(supplier.website) || na(supplier.Website);
  const instagram = na(csvRow?.['אינסטגרם']) || na(supplier.instagram);
  const facebook = na(csvRow?.['פייסבוק']) || na(supplier.facebook);

  for (const page of [website, instagram, facebook]) {
    if (!page || /easy\.co\.il/i.test(page)) continue;
    const html = await fetchHtml(page);
    push(extractOgImage(html));
    if (page === website && html) {
      extractPageImages(html, page)
        .slice(0, 8)
        .forEach(push);
    }
  }

  return urls.slice(0, 15);
}

async function saveImages(phone, urls) {
  const folder = phoneFolder(phone);
  const dir = path.join(MEDIA_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  let idx = 1;
  for (const url of urls) {
    if (saved.length >= MAX_IMAGES) break;
    const buf = await fetchBuffer(url);
    if (!buf) continue;
    const fileName = `img_${idx}.jpg`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    saved.push(`/media/suppliers/${folder}/${fileName}`);
    idx++;
  }
  return saved;
}

const legacyEasy = loadLegacyEasyByPhone();
const csvByPhone = loadDesktopCsvByPhone();
const suppliers = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const imagesMap = fs.existsSync(IMAGES_MAP_PATH)
  ? JSON.parse(fs.readFileSync(IMAGES_MAP_PATH, 'utf8'))
  : {};

let targets = suppliers.filter((s) => s.source_import === 'maparot-csv-2026-07');
if (LIMIT > 0) targets = targets.slice(0, LIMIT);

console.log(`Legacy Easy thumbs: ${legacyEasy.size}`);
console.log(`Downloading images for ${targets.length} maparot suppliers...\n`);

let ok = 0;
let fail = 0;

for (let i = 0; i < targets.length; i++) {
  const s = targets[i];
  const phone = s.real_phone || s.phone;
  const key = normalizePhone(phone);
  const csvRow = csvByPhone.get(key);
  const label = `${i + 1}/${targets.length} ${s.name}`.slice(0, 70);

  process.stdout.write(`[*] ${label}... `);

  const existingFiles = (s.images || [])
    .filter((img) => String(img).startsWith('/media/'))
    .filter((img) => fs.existsSync(path.join(ROOT, 'public', String(img).replace(/^\//, ''))));

  if (!FORCE && existingFiles.length >= 1) {
    s.images = existingFiles;
    imagesMap[s.name] = {
      downloaded_images: existingFiles,
      last_updated: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    console.log(`skip (${existingFiles.length} on disk)`);
    ok++;
    continue;
  }

  try {
    const urls = await collectCandidateUrls(s, csvRow, legacyEasy.get(key));
    const saved = await saveImages(phone, urls);
    if (saved.length) {
      s.images = saved;
      imagesMap[s.name] = {
        downloaded_images: saved,
        last_updated: new Date().toISOString().replace('T', ' ').slice(0, 19),
      };
      console.log(`✓ ${saved.length}`);
      ok++;
    } else {
      console.log(`✗ none (candidates=${urls.length})`);
      fail++;
    }
  } catch (err) {
    console.log(`✗ ${err.message}`);
    fail++;
  }

  if ((i + 1) % 5 === 0 || i === targets.length - 1) {
    fs.writeFileSync(JSON_PATH, JSON.stringify(suppliers, null, 2), 'utf8');
    fs.writeFileSync(IMAGES_MAP_PATH, JSON.stringify(imagesMap, null, 2), 'utf8');
  }

  await sleep(250);
}

fs.writeFileSync(JSON_PATH, JSON.stringify(suppliers, null, 2), 'utf8');
fs.writeFileSync(IMAGES_MAP_PATH, JSON.stringify(imagesMap, null, 2), 'utf8');
console.log(`\nDone. ok=${ok} fail=${fail}`);
