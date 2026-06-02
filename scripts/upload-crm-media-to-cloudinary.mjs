/**
 * Upload CRM local /media/ images to Cloudinary and replace paths in suppliers_complete.json.
 *
 * Run: node scripts/upload-crm-media-to-cloudinary.mjs
 * All suppliers: node scripts/upload-crm-media-to-cloudinary.mjs --all
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const jsonPath = path.join(projectRoot, 'data', 'suppliers_complete.json');
const uploadAll = process.argv.includes('--all');
const PHOTO_CATS = ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל'];

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(path.join(projectRoot, '.env.local'));
loadEnv(path.join(projectRoot, '.env'));

const { v2: cloudinary } = await import('cloudinary');
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.error('❌ CLOUDINARY_CLOUD_NAME missing from .env.local');
  process.exit(1);
}

function isPhotographer(supplier) {
  const category = (supplier.Category || supplier.category || '').toLowerCase();
  return PHOTO_CATS.some((part) => category.includes(part));
}

function shouldProcessSupplier(supplier) {
  return uploadAll || isPhotographer(supplier);
}

async function uploadLocalPath(localRelativePath, cache) {
  if (!localRelativePath?.startsWith('/media/')) return localRelativePath;
  if (cache.has(localRelativePath)) return cache.get(localRelativePath);

  const localFilePath = path.join(projectRoot, 'public', localRelativePath.replace(/^\//, ''));
  if (!fs.existsSync(localFilePath)) {
    cache.set(localRelativePath, null);
    return null;
  }

  const parts = localRelativePath.split('/').filter(Boolean);
  const folder = parts[parts.length - 2] || 'suppliers';
  const fileName = path.basename(localRelativePath, path.extname(localRelativePath));
  const publicId = `fiesta-crm/${folder}/${fileName}`;

  try {
    const result = await cloudinary.uploader.upload(localFilePath, {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
    });
    cache.set(localRelativePath, result.secure_url);
    return result.secure_url;
  } catch (err) {
    console.log(`    ❌ ${localRelativePath}: ${err.message}`);
    cache.set(localRelativePath, null);
    return null;
  }
}

function replacePaths(list, cache) {
  return list
    .map((item) => {
      if (typeof item !== 'string') return item;
      if (!item.startsWith('/media/')) return item;
      return cache.get(item) || item;
    })
    .filter(Boolean);
}

async function main() {
  const suppliers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const cache = new Map();
  const uniquePaths = new Set();

  for (const supplier of suppliers) {
    if (!shouldProcessSupplier(supplier)) continue;
    for (const item of [...(supplier.images || []), ...(supplier.portfolio || [])]) {
      if (typeof item === 'string' && item.startsWith('/media/')) uniquePaths.add(item);
    }
  }

  console.log(`☁️  Uploading ${uniquePaths.size} unique files (${uploadAll ? 'all suppliers' : 'photographers only'})...\n`);

  let uploaded = 0;
  let index = 0;
  for (const localPath of uniquePaths) {
    index += 1;
    process.stdout.write(`[${index}/${uniquePaths.size}] ${localPath.slice(0, 70)}... `);
    const url = await uploadLocalPath(localPath, cache);
    if (url?.startsWith('http')) {
      uploaded += 1;
      console.log('✅');
    } else {
      console.log('skip');
    }
  }

  let suppliersUpdated = 0;
  for (const supplier of suppliers) {
    if (!shouldProcessSupplier(supplier)) continue;

    const nextImages = replacePaths(supplier.images || [], cache);
    const nextPortfolio = replacePaths(supplier.portfolio || [], cache);
    const changed =
      JSON.stringify(nextImages) !== JSON.stringify(supplier.images || []) ||
      JSON.stringify(nextPortfolio) !== JSON.stringify(supplier.portfolio || []);

    if (!changed) continue;

    supplier.images = nextImages;
    supplier.portfolio = nextPortfolio;
    const main = nextPortfolio[0] || nextImages.find((item) => String(item).startsWith('http')) || supplier['Main Image'];
    if (main && String(main).startsWith('http')) {
      supplier['Main Image'] = main;
    }
    suppliersUpdated += 1;
  }

  fs.writeFileSync(jsonPath, `${JSON.stringify(suppliers, null, 2)}\n`, 'utf-8');

  console.log('\n========== SUMMARY ==========');
  console.log(`Uploaded: ${uploaded}/${uniquePaths.size}`);
  console.log(`Suppliers updated in JSON: ${suppliersUpdated}`);
  console.log(`Saved: ${jsonPath}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
