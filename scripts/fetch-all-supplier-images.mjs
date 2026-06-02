/**
 * fetch-all-supplier-images.mjs
 * Fetches owner images from Google / Instagram / website — not engaged sidebar ads.
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
  reorderSupplierImages,
  supplierHasDisplayImage,
} from '../lib/supplierImageSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const jsonPath = path.join(projectRoot, 'data', 'suppliers_complete.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractOgImage(html) {
  if (!html) return null;
  const match =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const url = match?.[1]?.trim();
  if (!url || !url.startsWith('http') || isBadEngagedImage(url)) return null;
  return url;
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

async function tryOg(url, referer) {
  const html = await fetchHtml(url, referer);
  return extractOgImage(html);
}

async function getImageForSupplier(supplier) {
  const stored = pickBestStoredImage(supplier);
  if (stored && String(stored).startsWith('http')) return stored;

  const googleImage = getGoogleImageUrl(supplier);
  if (googleImage) return googleImage;

  for (const instaUrl of extractInstagramUrls(supplier)) {
    const imageUrl = await tryOg(instaUrl, 'https://www.instagram.com/');
    if (imageUrl) return imageUrl;
  }

  const website = extractWebsiteUrl(supplier);
  if (website) {
    const imageUrl = await tryOg(website, website);
    if (imageUrl) return imageUrl;
  }

  const engagedUrl = supplier.engaged_url || supplier.URL || '';
  if (engagedUrl) {
    const imageUrl = await tryOg(engagedUrl, 'https://engaged.co.il/');
    if (imageUrl) return imageUrl;
  }

  return null;
}

async function main() {
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ suppliers_complete.json not found');
    process.exit(1);
  }

  const suppliers = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`📦 Loaded ${suppliers.length} suppliers\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < suppliers.length; i++) {
    const s = reorderSupplierImages(suppliers[i]);
    suppliers[i] = s;

    const name = (s.clean_name || s.name || '').slice(0, 40);
    if (supplierHasDisplayImage(s) && pickBestStoredImage(s)?.startsWith?.('/media/')) {
      skipped++;
      continue;
    }

    if (supplierHasDisplayImage(s) && !isBadEngagedImage(pickBestStoredImage(s))) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${suppliers.length}] ${name}... `);
    const imageUrl = await getImageForSupplier(s);
    if (imageUrl) {
      s.images = [
        imageUrl,
        ...((s.images || []).filter((img) => !String(img).startsWith('http') || isBadEngagedImage(img))),
      ].filter((img) => !isBadEngagedImage(img));
      updated++;
      console.log(`✅ ${imageUrl.slice(0, 70)}`);
    } else {
      failed++;
      console.log('❌ no image found');
    }

    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(jsonPath, JSON.stringify(suppliers, null, 2), 'utf8');
      console.log(`   💾 Progress saved (${updated} updated so far)`);
    }

    await sleep(400);
  }

  fs.writeFileSync(jsonPath, JSON.stringify(suppliers, null, 2), 'utf8');

  console.log('\n========== SUMMARY ==========');
  console.log(`✅ Updated:  ${updated}`);
  console.log(`⏭️  Skipped:  ${skipped}`);
  console.log(`❌ Failed:   ${failed}`);
  console.log(`📁 Saved to: ${jsonPath}`);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
