/**
 * Second pass — aggressive image fetch for photographers still missing images.
 *
 * Run: node scripts/update-photographer-images-round2.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractInstagramUrls,
  extractWebsiteUrl,
  getGoogleImageUrl,
  isBadEngagedImage,
} from '../lib/supplierImageSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const jsonPath = path.join(projectRoot, 'data', 'suppliers_complete.json');
const mediaRoot = path.join(projectRoot, 'public', 'media', 'portfolios');
const MAX_IMAGES = 3;
const MIN_BYTES = 2500;
const SERPER_API_KEY = process.env.SERPER_API_KEY || 'ae9018b64b8a4a24a1639012bc57ec00d5330e78';
const PHOTO_CATS = ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל'];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isPhotographer(supplier) {
  const category = (supplier.Category || supplier.category || '').toLowerCase();
  return PHOTO_CATS.some((part) => category.includes(part));
}

function phoneFolder(supplier) {
  return String(supplier.real_phone || supplier['Real Phone'] || supplier.phone || supplier.id || 'unknown')
    .trim()
    .replace(/[^\d-]/g, '');
}

function localPortfolioPaths(supplier) {
  const folder = phoneFolder(supplier);
  const dir = path.join(mediaRoot, folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => /^portfolio_\d+\.(jpg|jpeg|png|webp)$/i.test(file))
    .sort()
    .map((file) => `/media/portfolios/${folder}/${file}`);
}

function needsImages(supplier) {
  return localPortfolioPaths(supplier).length < 1;
}

function cleanName(supplier) {
  return String(supplier.clean_name || supplier.name || '').split('|')[0].trim();
}

function nameTokens(supplier) {
  const raw = `${cleanName(supplier)} ${supplier.name || ''}`;
  return [...new Set(
    raw
      .split(/[\s|,/\\-]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 2)
  )];
}

function isGoodImageUrl(url, relaxed = false) {
  if (!url || !String(url).startsWith('http')) return false;
  if (isBadEngagedImage(url)) return false;
  const value = String(url).toLowerCase();
  if (/favicon|sprite|pixel|emoji|badge|\.svg$/i.test(value)) return false;
  if (!relaxed && /logo|icon|avatar/.test(value)) return false;
  return true;
}

async function fetchBuffer(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, Referer: referer || url },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_BYTES) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image') && !/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return null;
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, Referer: referer || url },
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

function extractOgImage(html, relaxed = false) {
  if (!html) return null;
  const match =
    html.match(/property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
  const url = match?.[1]?.trim();
  return isGoodImageUrl(url, relaxed) ? url : null;
}

function extractGalleryImages(html, baseUrl, limit = 8) {
  if (!html) return [];
  const found = new Set();
  const base = baseUrl.match(/^https?:\/\/[^/]+/)?.[0] || '';
  const regex = /<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let imgUrl = match[1];
    if (imgUrl.startsWith('//')) imgUrl = `https:${imgUrl}`;
    else if (imgUrl.startsWith('/')) imgUrl = `${base}${imgUrl}`;
    if (isGoodImageUrl(imgUrl, true)) found.add(imgUrl);
    if (found.size >= limit) break;
  }
  return [...found];
}

function extractOwnEngagedImages(html, supplier) {
  if (!html) return [];
  const tokens = nameTokens(supplier).map((token) => token.toLowerCase().replace(/\s+/g, '_'));
  const regex = /https?:\/\/engaged\.co\.il\/images\/stories\/deals\/\d+\/images\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/gi;
  return [...new Set(html.match(regex) || [])].filter((url) => {
    if (isBadEngagedImage(url)) return false;
    const lower = decodeURIComponent(url).toLowerCase();
    return tokens.some((token) => lower.includes(token));
  });
}

function extractReviewSourceUrls(supplier) {
  const urls = new Set();
  for (const review of supplier.reviews || []) {
    const source = review?.source || '';
    if (source.startsWith('http')) urls.add(source.split('?')[0]);
  }
  return [...urls];
}

function extractInstagramHandles(supplier) {
  const handles = new Set();
  const addFromText = (text) => {
    if (!text) return;
    const handleMatch = text.match(/@([a-z0-9._]{3,})/i);
    if (handleMatch) handles.add(handleMatch[1]);
    const igMatch = text.match(/instagram\.com\/([a-z0-9._]+)/i);
    if (igMatch && !['p', 'reel', 'popular'].includes(igMatch[1].toLowerCase())) {
      handles.add(igMatch[1]);
    }
  };

  addFromText(supplier.website);
  for (const review of supplier.reviews || []) {
    addFromText(review.source);
    addFromText(review.text);
  }

  return [...handles].map((handle) => `https://www.instagram.com/${handle}/`);
}

async function serperImages(queries) {
  const urls = [];
  for (const q of queries) {
    try {
      const res = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q, gl: 'il', num: 12 }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of data.images || []) {
        if (isGoodImageUrl(item.imageUrl, true)) urls.push(item.imageUrl);
      }
    } catch {
      // continue
    }
    await sleep(300);
  }
  return urls;
}

function buildSerperQueries(supplier) {
  const name = cleanName(supplier);
  const english = String(supplier.name || '').split('|').pop()?.trim() || '';
  return [
    `${name} צלם חתונה`,
    `${name} צילום אירועים`,
    `${english} wedding photographer israel`,
    `${name} instagram`,
    `site:instagram.com ${name}`,
    `${name} ${supplier.real_phone || ''}`.trim(),
  ].filter((q) => q.length > 4);
}

async function collectCandidateUrls(supplier) {
  const urls = [];
  const seen = new Set();
  const add = (url, relaxed = false) => {
    if (!isGoodImageUrl(url, relaxed) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  add(getGoogleImageUrl(supplier));

  for (const http of supplier.images || []) {
    if (String(http).startsWith('http')) add(http, true);
  }

  const engagedUrl = supplier.engaged_url || supplier.URL || '';
  if (engagedUrl) {
    const html = await fetchHtml(engagedUrl, 'https://engaged.co.il/');
    extractOwnEngagedImages(html, supplier).forEach((url) => add(url, true));
    add(extractOgImage(html, true), true);
  }

  const instagramUrls = [
    ...extractInstagramUrls(supplier),
    ...extractInstagramHandles(supplier),
  ];
  for (const instaUrl of instagramUrls) {
    if (urls.length >= MAX_IMAGES * 4) break;
    const html = await fetchHtml(instaUrl, 'https://www.instagram.com/');
    add(extractOgImage(html, true), true);
    await sleep(200);
  }

  const website = extractWebsiteUrl(supplier);
  if (website) {
    const html = await fetchHtml(website, website);
    add(extractOgImage(html, true), true);
    extractGalleryImages(html, website).forEach((url) => add(url, true));
  }

  for (const sourceUrl of extractReviewSourceUrls(supplier)) {
    if (urls.length >= MAX_IMAGES * 4) break;
    if (/mit4mit|facebook|digital-card|b144|d\.co\.il/i.test(sourceUrl)) {
      const html = await fetchHtml(sourceUrl, sourceUrl);
      add(extractOgImage(html, true), true);
      extractGalleryImages(html, sourceUrl, 4).forEach((url) => add(url, true));
      await sleep(200);
    }
  }

  const serperUrls = await serperImages(buildSerperQueries(supplier));
  serperUrls.forEach((url) => add(url, true));

  return urls;
}

async function downloadImages(urls, folder) {
  fs.mkdirSync(folder, { recursive: true });
  const saved = [];

  for (const url of urls) {
    if (saved.length >= MAX_IMAGES) break;
    const buffer = await fetchBuffer(url, url);
    if (!buffer) continue;
    const fileName = `portfolio_${saved.length + 1}.jpg`;
    fs.writeFileSync(path.join(folder, fileName), buffer);
    saved.push(`/media/portfolios/${path.basename(folder)}/${fileName}`);
  }

  return saved;
}

async function main() {
  const suppliers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const targets = suppliers.filter((s) => isPhotographer(s) && needsImages(s));

  console.log(`🔁 Round 2 — ${targets.length} photographers without images\n`);

  let updated = 0;
  let downloadedTotal = 0;

  for (let i = 0; i < targets.length; i += 1) {
    const supplier = targets[i];
    const name = cleanName(supplier).slice(0, 50);
    const folderName = phoneFolder(supplier);
    const folderPath = path.join(mediaRoot, folderName);

    process.stdout.write(`[${i + 1}/${targets.length}] ${name}... `);

    const candidates = await collectCandidateUrls(supplier);
    const downloaded = await downloadImages(candidates, folderPath);

    if (downloaded.length === 0) {
      console.log(`❌ tried ${candidates.length} urls`);
      continue;
    }

    supplier.portfolio = downloaded;
    supplier.images = downloaded;
    supplier['Main Image'] = downloaded[0];
    updated += 1;
    downloadedTotal += downloaded.length;
    console.log(`✅ ${downloaded.length} (${candidates.length} candidates)`);

    fs.writeFileSync(jsonPath, `${JSON.stringify(suppliers, null, 2)}\n`, 'utf-8');
    await sleep(500);
  }

  console.log('\n========== ROUND 2 SUMMARY ==========');
  console.log(`Updated: ${updated}/${targets.length}`);
  console.log(`Images downloaded: ${downloadedTotal}`);
  console.log(`Still missing: ${targets.length - updated}`);
}

main().catch((error) => {
  console.error('ERROR:', error);
  process.exit(1);
});
