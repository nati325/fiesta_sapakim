/**
 * Fix failed Cloudinary uploads: replace HTML fakes, compress large JPEGs, re-upload.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const jsonPath = path.join(projectRoot, 'data', 'suppliers_complete.json');
const mediaRoot = path.join(projectRoot, 'public', 'media', 'portfolios');

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

const { v2: cloudinary } = await import('cloudinary');
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const SERPER_KEY = process.env.SERPER_API_KEY || 'ae9018b64b8a4a24a1639012bc57ec00d5330e78';

const FIXES = [
  { folder: '052-237-4077', file: 'portfolio_1.jpg', source: 'https://engaged.co.il/images/stories/deals/1452/images/%D7%99%D7%A0%D7%99%D7%91_%D7%90%D7%98%D7%99%D7%94_51.jpg', compress: true },
  { folder: '052-237-4077', file: 'portfolio_2.jpg', query: 'יניב אטיה צלם חתונה' },
  { folder: '050-7383488', file: 'portfolio_2.jpg', source: 'https://engaged.co.il/images/stories/deals/3122/images/%D7%A9%D7%99_%D7%9E%D7%A0%D7%A9%D7%94_%D7%9C%D7%95%D7%99_%D7%A6%D7%99%D7%9C%D7%95%D7%9D_5.jpeg' },
  { folder: '052-2949769', file: 'portfolio_2.jpg', source: 'http://yofi-y.co.il' },
  { folder: '052-303-7451', file: 'portfolio_2.jpg', compressOnly: true },
  { folder: '054-6330630', file: 'portfolio_1.jpg', query: 'netoVR making future memory צלם' },
  { folder: '050-3467775', file: 'portfolio_1.jpg', query: 'דור דניאל צלם חתונה' },
  { folder: '221', file: 'portfolio_1.jpg', query: 'אור יעקב סושיאל חתונה' },
  { folder: '055-662-0660', file: 'portfolio_1.jpg', query: 'זיו שמשון צילום' },
  { folder: '0545428670', file: 'portfolio_1.jpg', query: 'שיר נגר סושיאל צלמת' },
  { folder: '0545428670', file: 'portfolio_2.jpg', query: 'shir nagar social photographer' },
  { folder: '0545428670', file: 'portfolio_3.jpg', query: 'site:instagram.com shir__nagar_' },
];

async function downloadUrl(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 2000) return null;
  if (buffer.slice(0, 15).toString('utf8').includes('<!DOCTYPE')) return null;
  return buffer;
}

async function fetchOg(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return match?.[1]?.startsWith('http') ? match[1] : null;
}

async function serperImage(query) {
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'il', num: 8 }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const item of data.images || []) {
    const buf = await downloadUrl(item.imageUrl);
    if (buf) return buf;
  }
  return null;
}

async function prepareBuffer(fix) {
  const localPath = path.join(mediaRoot, fix.folder, fix.file);

  if (fix.compressOnly && fs.existsSync(localPath)) {
    return sharp(localPath).resize(1600, null, { withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  }

  if (fix.source?.startsWith('http')) {
    if (fix.source.includes('yofi-y.co.il')) {
      const og = await fetchOg(fix.source);
      if (og) {
        const buf = await downloadUrl(og);
        if (buf) return buf;
      }
    }
    const buf = await downloadUrl(fix.source);
    if (buf) {
      if (fix.compress || buf.length > 9_500_000) {
        return sharp(buf).resize(1600, null, { withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      }
      return buf;
    }
  }

  if (fix.query) {
    const buf = await serperImage(fix.query);
    if (buf) return buf;
  }

  return null;
}

async function uploadBuffer(localRelativePath, buffer) {
  const parts = localRelativePath.split('/').filter(Boolean);
  const folder = parts[parts.length - 2];
  const fileName = path.basename(localRelativePath, path.extname(localRelativePath));
  const publicId = `fiesta-crm/${folder}/${fileName}`;
  const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${buffer.toString('base64')}`, {
    public_id: publicId,
    overwrite: true,
    resource_type: 'image',
  });
  return result.secure_url;
}

function replaceInSupplier(supplier, localPath, cloudUrl) {
  const replaceList = (list) =>
    (list || []).map((item) => (item === localPath ? cloudUrl : item));

  supplier.images = replaceList(supplier.images);
  supplier.portfolio = replaceList(supplier.portfolio);
  if (supplier['Main Image'] === localPath) supplier['Main Image'] = cloudUrl;
}

async function main() {
  const suppliers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  let fixed = 0;

  for (const fix of FIXES) {
    const localRelative = `/media/portfolios/${fix.folder}/${fix.file}`;
    process.stdout.write(`${localRelative}... `);

    const buffer = await prepareBuffer(fix);
    if (!buffer) {
      console.log('❌ no replacement');
      continue;
    }

    fs.mkdirSync(path.join(mediaRoot, fix.folder), { recursive: true });
    const localFull = path.join(mediaRoot, fix.folder, fix.file);
    try {
      fs.writeFileSync(localFull, buffer);
    } catch {
      // keep going — Cloudinary URL is what matters for production
    }

    try {
      const cloudUrl = await uploadBuffer(localRelative, buffer);
      for (const supplier of suppliers) {
        replaceInSupplier(supplier, localRelative, cloudUrl);
      }
      fixed += 1;
      console.log('✅');
    } catch (err) {
      console.log(`❌ upload: ${err.message}`);
    }
  }

  fs.writeFileSync(jsonPath, `${JSON.stringify(suppliers, null, 2)}\n`, 'utf-8');
  console.log(`\nFixed and uploaded: ${fixed}/${FIXES.length}`);
}

main().catch(console.error);
