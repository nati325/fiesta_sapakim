import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../lib/supplierEnrichment.js';
import { buildDefaultFiestaData, findExistingVendor, pushSupplierToFiesta } from '../lib/fiestaPushCore.js';
import { collectSupplierImages } from '../lib/fiestaCategoryMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const PHONE = '052-3300403';

function loadEnvFile(filePath) {
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

function phoneKey(value) {
  return String(value || '').replace(/\D/g, '');
}

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

async function main() {
  process.chdir(projectRoot);
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) {
    console.error('ERROR: FIESTA_MONGODB_URI missing in .env.local');
    process.exit(1);
  }

  const { list } = loadSuppliersFromJson();
  const raw = list.find((s) => phoneKey(s['Real Phone'] || s.real_phone || s.phone) === phoneKey(PHONE));
  if (!raw) {
    console.error('ERROR: Lior Perez not found in suppliers JSON');
    process.exit(1);
  }

  const supplier = normalizeSupplierRecord(raw);
  const images = collectSupplierImages(supplier);
  const fiestaData = buildDefaultFiestaData(supplier, {
    type: 'dj',
    agentName: 'ינון',
    agreementSigned: true,
    selectedImages: images,
    images,
    description: supplier.description || 'DJ ליאור פרץ — Full Volume דיגיי לחתונה',
  });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  const existing = await findExistingVendor(vendors, supplier);
  if (existing) {
    console.log('EXISTS: already in Fiesta —', existing.name, '| id:', existing._id);
    await client.close();
    process.exit(0);
  }

  const result = await pushSupplierToFiesta({
    vendorsCollection: vendors,
    supplier,
    fiestaData,
    origin: process.env.SCRAPING_PUBLIC_URL || 'https://fiesta-sapakim.vercel.app',
  });
  await client.close();

  const report = {
    ...result,
    phone: PHONE,
    fiestaType: 'dj',
    imageCount: images.length,
  };

  fs.writeFileSync(path.join(projectRoot, 'bulk-push-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('SUCCESS:', JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
