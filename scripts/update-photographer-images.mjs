/**
 * Download up to 3 owner images per photographer (Google → Instagram → website → Serper).
 *
 * Run: node scripts/update-photographer-images.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractInstagramUrls,
  extractWebsiteUrl,
  getGoogleImageUrl,
  isBadEngagedImage,
  pickBestStoredImage,
} from '../lib/supplierImageSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const jsonPath = path.join(projectRoot, 'data', 'suppliers_complete.json');
const csvPath = path.join(projectRoot, 'scraping', 'engaged_suppliers_final_production.csv');
const mediaRoot = path.join(projectRoot, 'public', 'media', 'portfolios');
const MAX_IMAGES = 3;
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

function loadCsvByPhone() {
  if (!fs.existsSync(csvPath)) return {};
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  const phoneIdx = headers.indexOf('Real Phone');
  const googleIdx = headers.indexOf('Google Image');
  const galleryIdx = headers.indexOf('Gallery');
  const websiteIdx = headers.indexOf('Website');
  const map = {};

  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const phone = (cols[phoneIdx] || '').replace(/\D/g, '');
    if (!phone) continue;
    map[phone] = {
      googleImage: cols[googleIdx] || '',
      gallery: cols[galleryIdx] || '',
      website: cols[websiteIdx] || '',
    };
  }
  return map;
}

function parseCsvGallery(raw) {
  if (!raw || raw === 'N/A' || raw === 'nan') return [];
  return raw.split(/[|,\n]/).map((item) => item.trim()).filter((item) => item.startsWith('http'));
}

function isGoodImageUrl(url) {
  if (!url || !String(url).startsWith('http')) return false;
  if (isBadEngagedImage(url)) return false;
  const value = String(url).toLowerCase();
  if (/logo|favicon|icon|sprite|avatar|pixel|emoji|badge/.test(value)) return false;
  if (value.endsWith('.svg')) return false;
  return true;
}

async function fetchBuffer(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, Referer: referer || url },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 5000) return null;
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
  const timer = setTimeout(() => controller.abort(), 12000);
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

function extractOgImage(html) {
  if (!html) return null;
  const match =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const url = match?.[1]?.trim();
  return isGoodImageUrl(url) ? url : null;
}

function extractGalleryImages(html, baseUrl) {
  if (!html) return [];
  const found = new Set();
  const base = baseUrl.match(/^https?:\/\/[^/]+/)?.[0] || '';
  const regex = /<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let imgUrl = match[1];
    if (imgUrl.startsWith('//')) imgUrl = `https:${imgUrl}`;
    else if (imgUrl.startsWith('/')) imgUrl = `${base}${imgUrl}`;
    if (isGoodImageUrl(imgUrl)) found.add(imgUrl);
    if (found.size >= MAX_IMAGES) break;
  }
  return [...found];
}

async function serperImages(name, category) {
  const cleanName = String(name).split('|')[0].trim();
  const query = `${cleanName} ${category} צילום חתונה`;
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, gl: 'il', num: 8 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.images || [])
      .map((item) => item.imageUrl)
      .filter(isGoodImageUrl)
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function collectCandidateUrls(supplier, csvRow) {
  const urls = [];
  const seen = new Set();
  const add = (url) => {
    if (!isGoodImageUrl(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  add(getGoogleImageUrl(supplier));
  if (csvRow?.googleImage?.startsWith('http')) add(csvRow.googleImage.trim());
  parseCsvGallery(csvRow?.gallery).forEach(add);

  const instagramUrls = extractInstagramUrls(supplier);
  const postUrls = instagramUrls.filter((url) => /instagram\.com\/(p|reel)\//i.test(url));
  const profileUrls = instagramUrls.filter((url) => !/instagram\.com\/(p|reel)\//i.test(url));

  for (const instaUrl of postUrls) {
    if (urls.length >= MAX_IMAGES) break;
    const html = await fetchHtml(instaUrl, 'https://www.instagram.com/');
    add(extractOgImage(html));
    await sleep(250);
  }

  for (const instaUrl of profileUrls) {
    if (urls.length >= MAX_IMAGES) break;
    const html = await fetchHtml(instaUrl, 'https://www.instagram.com/');
    add(extractOgImage(html));
    await sleep(250);
  }

  const website = extractWebsiteUrl(supplier) || (csvRow?.website?.startsWith('http') ? csvRow.website : null);
  if (website && urls.length < MAX_IMAGES) {
    const html = await fetchHtml(website, website);
    add(extractOgImage(html));
    extractGalleryImages(html, website).forEach(add);
  }

  if (urls.length < MAX_IMAGES) {
    const serper = await serperImages(supplier.name || supplier['Supplier Name'], supplier.category || supplier.Category || 'צלמים');
    for (const url of serper) {
      if (urls.length >= MAX_IMAGES) break;
      add(url);
    }
  }

  return urls.slice(0, MAX_IMAGES);
}

async function downloadImages(urls, folder) {
  fs.mkdirSync(folder, { recursive: true });
  const saved = [];

  for (let i = 0; i < urls.length && saved.length < MAX_IMAGES; i += 1) {
    const buffer = await fetchBuffer(urls[i], urls[i]);
    if (!buffer) continue;
    const fileName = `portfolio_${saved.length + 1}.jpg`;
    const fullPath = path.join(folder, fileName);
    fs.writeFileSync(fullPath, buffer);
    saved.push(`/media/portfolios/${path.basename(folder)}/${fileName}`);
  }

  return saved;
}

async function main() {
  const suppliers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const csvByPhone = loadCsvByPhone();
  const photographers = suppliers.filter(isPhotographer);

  console.log(`📸 Updating up to ${MAX_IMAGES} images for ${photographers.length} photographers\n`);

  let updated = 0;
  let downloadedTotal = 0;

  for (let i = 0; i < photographers.length; i += 1) {
    const supplier = photographers[i];
    const name = (supplier.name || supplier['Supplier Name'] || '').slice(0, 50);
    const folderName = phoneFolder(supplier);
    const csvRow = csvByPhone[folderName.replace(/\D/g, '')] || null;
    const folderPath = path.join(mediaRoot, folderName);

    process.stdout.write(`[${i + 1}/${photographers.length}] ${name}... `);

    const existingLocal = (supplier.portfolio || supplier.images || []).filter((item) => String(item).startsWith('/media/'));
    const existingFiles = existingLocal.filter((relPath) => {
      const full = path.join(projectRoot, 'public', relPath.replace(/^\//, ''));
      return fs.existsSync(full);
    }).slice(0, MAX_IMAGES);

    if (existingFiles.length >= MAX_IMAGES) {
      supplier.portfolio = existingFiles;
      supplier.images = [...existingFiles];
      supplier['Main Image'] = pickBestStoredImage(supplier) || existingFiles[0];
      console.log(`skip (${existingFiles.length} local files exist)`);
      continue;
    }

    const candidates = await collectCandidateUrls(supplier, csvRow);
    const downloaded = await downloadImages(candidates, folderPath);

    if (downloaded.length === 0 && existingFiles.length > 0) {
      supplier.portfolio = existingFiles;
      supplier.images = [...existingFiles];
      supplier['Main Image'] = existingFiles[0];
      console.log(`keep ${existingFiles.length} existing`);
      continue;
    }

    if (downloaded.length === 0) {
      console.log('❌ no images');
      continue;
    }

    supplier.portfolio = downloaded;
    supplier.images = downloaded;
    supplier['Main Image'] = downloaded[0];
    updated += 1;
    downloadedTotal += downloaded.length;
    console.log(`✅ ${downloaded.length} images`);

    if ((i + 1) % 5 === 0) {
      fs.writeFileSync(jsonPath, `${JSON.stringify(suppliers, null, 2)}\n`, 'utf-8');
      console.log('   💾 progress saved');
    }

    await sleep(400);
  }

  fs.writeFileSync(jsonPath, `${JSON.stringify(suppliers, null, 2)}\n`, 'utf-8');

  console.log('\n========== SUMMARY ==========');
  console.log(`Updated photographers: ${updated}`);
  console.log(`Images downloaded: ${downloadedTotal}`);
  console.log(`Saved: ${jsonPath}`);
  console.log(`Media: ${mediaRoot}`);
}

main().catch((error) => {
  console.error('ERROR:', error);
  process.exit(1);
});
