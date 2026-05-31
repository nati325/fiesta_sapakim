/**
 * fetch-all-supplier-images.mjs
 * Fetches image URLs from engaged.co.il (and website og:image fallback)
 * and saves them into suppliers_complete.json as https URLs.
 *
 * Run: node scripts/fetch-all-supplier-images.mjs
 * Or:  fetch-all-images.bat
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const jsonPath = path.join(projectRoot, 'data', 'suppliers_complete.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
  Referer: 'https://engaged.co.il/',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractFromEngaged(html) {
  if (!html) return null;

  // OG image
  const og =
    html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1];
  if (og?.startsWith('http') && !og.includes('logo_new')) return og;

  // Only search top portion of page (before sidebar recommendations)
  const top = html.slice(0, Math.floor(html.length * 0.45));

  // Gallery large version
  const galleryMatch = top.match(
    /\/\/images\/stories\/deals\/(\d+)\/images\/resize\/([^"'\s]+?)_small\.(jpg|jpeg|png)/i
  );
  if (galleryMatch) {
    return `https://engaged.co.il/images/stories/deals/${galleryMatch[1]}/images/resize/${galleryMatch[2]}_large.${galleryMatch[3]}`;
  }

  // Any deals image in top section
  const anyImg = top.match(/https?:\/\/engaged\.co\.il\/+\/images\/stories\/deals\/[^"'\s]+\.(jpg|jpeg|png|webp)/i);
  if (anyImg) return anyImg[0].replace(/\/+\/images/, '/images');

  // Logo as last resort
  const logoMatch = top.match(/\/images\/stories\/deals\/(\d+)\/logo\/resize\/([^"'\s]+?)_tiny\.(jpg|jpeg|png)/i);
  if (logoMatch) {
    return `https://engaged.co.il/images/stories/deals/${logoMatch[1]}/logo/resize/${logoMatch[2]}_small.${logoMatch[3]}`;
  }

  return null;
}

function extractOgFromWebsite(html) {
  if (!html) return null;
  const og =
    html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1];
  return og?.startsWith('http') ? og : null;
}

function hasHttpImage(supplier) {
  return (supplier.images || []).some((i) => String(i).startsWith('http'));
}

async function getImageForSupplier(supplier) {
  if (hasHttpImage(supplier)) {
    return supplier.images.find((i) => String(i).startsWith('http'));
  }

  const engagedUrl = supplier.engaged_url || '';
  if (engagedUrl) {
    const html = await fetchHtml(engagedUrl);
    const img = extractFromEngaged(html);
    if (img) return img;
  }

  const website = supplier.website || '';
  if (website && website.startsWith('http')) {
    const html = await fetchHtml(website);
    const img = extractOgFromWebsite(html);
    if (img) return img;
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
    const s = suppliers[i];
    const name = (s.clean_name || s.name || '').slice(0, 40);
    const phone = s.real_phone || s.phone || '';

    if (hasHttpImage(s)) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${suppliers.length}] ${name}... `);

    const imageUrl = await getImageForSupplier(s);
    if (imageUrl) {
      s.images = [imageUrl, ...(s.images || []).filter((img) => !String(img).startsWith('http'))];
      updated++;
      console.log(`✅ ${imageUrl.slice(0, 70)}`);
    } else {
      failed++;
      console.log('❌ no image found');
    }

    // Save progress every 25 suppliers
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(jsonPath, JSON.stringify(suppliers, null, 2), 'utf8');
      console.log(`   💾 Progress saved (${updated} updated so far)`);
    }

    await sleep(400); // be nice to engaged.co.il
  }

  fs.writeFileSync(jsonPath, JSON.stringify(suppliers, null, 2), 'utf8');

  console.log('\n========== SUMMARY ==========');
  console.log(`✅ Updated:  ${updated}`);
  console.log(`⏭️  Skipped:  ${skipped} (already had http image)`);
  console.log(`❌ Failed:   ${failed}`);
  console.log(`📁 Saved to: ${jsonPath}`);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
