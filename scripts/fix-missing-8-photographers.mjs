/**
 * Round 3 — fix last 8 photographers: direct JSON URLs + long timeout downloads.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractInstagramUrls,
  extractWebsiteUrl,
  isBadEngagedImage,
} from '../lib/supplierImageSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const jsonPath = path.join(projectRoot, 'data', 'suppliers_complete.json');
const mediaRoot = path.join(projectRoot, 'public', 'media', 'portfolios');
const MAX_IMAGES = 3;
const SERPER_API_KEY = process.env.SERPER_API_KEY || 'ae9018b64b8a4a24a1639012bc57ec00d5330e78';

const TARGET_IDS = new Set([205, 216, 221, 225, 227, 244, 247, 249]);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

function phoneFolder(supplier) {
  const phone = supplier.real_phone || supplier['Real Phone'] || supplier.phone;
  if (phone) return String(phone).trim().replace(/[^\d-]/g, '');
  return String(supplier.id || 'unknown');
}

function hasPortfolio(supplier) {
  const dir = path.join(mediaRoot, phoneFolder(supplier));
  try {
    return fs.readdirSync(dir).some((f) => /^portfolio_\d+\./i.test(f));
  } catch {
    return false;
  }
}

function cleanName(supplier) {
  return String(supplier.clean_name || supplier.name || '').split('|')[0].trim();
}

async function downloadUrl(url, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, Referer: new URL(url).origin + '/' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 2000) return null;
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOg(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        Accept: 'text/html',
        Referer: 'https://www.instagram.com/',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
    return match?.[1]?.startsWith('http') ? match[1] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function serperUrls(query) {
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'il', num: 10 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.images || [])
      .map((item) => item.imageUrl)
      .filter((url) => url?.startsWith('http') && !isBadEngagedImage(url));
  } catch {
    return [];
  }
}

function collectUrls(supplier) {
  const urls = [];
  const seen = new Set();
  const add = (url) => {
    if (!url || !url.startsWith('http') || isBadEngagedImage(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  for (const item of supplier.images || []) add(String(item));
  for (const item of supplier.portfolio || []) {
    if (String(item).startsWith('http')) add(String(item));
  }

  for (const review of supplier.reviews || []) {
    const src = review?.source || '';
    if (/instagram\.com\/(p|reel)\//i.test(src)) add(src.split('?')[0]);
  }

  add(extractWebsiteUrl(supplier));
  extractInstagramUrls(supplier).forEach(add);

  return urls;
}

async function buildDownloadList(supplier) {
  const urls = collectUrls(supplier);
  const name = cleanName(supplier);

  for (const instaUrl of urls.filter((u) => /instagram\.com/i.test(u))) {
    const og = await fetchOg(instaUrl);
    if (og) urls.unshift(og);
  }

  const queries = [
    `${name} צלם חתונה`,
    `${name} instagram`,
    `site:instagram.com ${name}`,
    `${supplier.name?.split('|').pop()?.trim() || name} photographer`,
  ];

  for (const query of queries) {
    if (urls.length >= 15) break;
    const found = await serperUrls(query);
    urls.push(...found);
  }

  return [...new Set(urls)];
}

async function saveImages(supplier, urls) {
  const folderName = phoneFolder(supplier);
  const folderPath = path.join(mediaRoot, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  const saved = [];
  for (const url of urls) {
    if (saved.length >= MAX_IMAGES) break;
    process.stdout.write(`    try ${url.slice(0, 70)}... `);
    const buffer = await downloadUrl(url);
    if (!buffer) {
      console.log('fail');
      continue;
    }
    const fileName = `portfolio_${saved.length + 1}.jpg`;
    fs.writeFileSync(path.join(folderPath, fileName), buffer);
    saved.push(`/media/portfolios/${folderName}/${fileName}`);
    console.log(`ok (${Math.round(buffer.length / 1024)}KB)`);
  }
  return saved;
}

async function main() {
  const suppliers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const targets = suppliers.filter((s) => TARGET_IDS.has(s.id) && !hasPortfolio(s));

  console.log(`🎯 Round 3 — fixing ${targets.length} photographers\n`);

  let updated = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const supplier = targets[i];
    console.log(`[${i + 1}/${targets.length}] ${cleanName(supplier)}`);

    const urls = await buildDownloadList(supplier);
    console.log(`  ${urls.length} candidate URLs`);
    const saved = await saveImages(supplier, urls);

    if (saved.length === 0) {
      console.log('  ❌ still no images\n');
      continue;
    }

    supplier.portfolio = saved;
    supplier.images = saved;
    supplier['Main Image'] = saved[0];
    updated += 1;
    console.log(`  ✅ saved ${saved.length}\n`);

    fs.writeFileSync(jsonPath, `${JSON.stringify(suppliers, null, 2)}\n`, 'utf-8');
  }

  const stillMissing = targets.length - updated;
  console.log('========== ROUND 3 ==========');
  console.log(`Updated: ${updated}/${targets.length}`);
  console.log(`Still missing: ${stillMissing}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
