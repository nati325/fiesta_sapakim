/**
 * push-missing-djs.mjs
 * Pushes ליאור פרץ and שרון כהן to Fiesta DB with full data
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../lib/supplierEnrichment.js';
import { buildDefaultFiestaData, findExistingVendor, pushSupplierToFiesta } from '../lib/fiestaPushCore.js';
import { collectSupplierImages } from '../lib/fiestaCategoryMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function phoneKey(v) { return String(v || '').replace(/\D/g, ''); }

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

const MISSING = [
  { phone: '052-3300403', description: 'לזוגות המתכננים את יום חתונתם המיוחד, דיגיי ליאור פרץ מציע חוויה מוזיקלית בלתי נשכחת. עם ניסיון עשיר של למעלה מ-14 שנים בעולם המוזיקה והאירועים, ליאור מביא עמו ידע מקצועי וכישרון יוצא דופן.' },
  { phone: '054-4850419', description: 'שרון כהן — DJ מקצועי לחתונות ואירועים. ניסיון רב, מוזיקה לכל טעם, אנרגיה שמחה לאורך כל הערב.' },
];

async function main() {
  process.chdir(projectRoot);

  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) { console.error('FIESTA_MONGODB_URI missing'); process.exit(1); }

  console.log('Connecting to Fiesta MongoDB...');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  console.log('Loading suppliers JSON...');
  const { byPhone } = loadSuppliersFromJson(projectRoot);
  console.log(`Loaded ${Object.keys(byPhone).length} suppliers`);

  for (const { phone, description } of MISSING) {
    const digits = phoneKey(phone);
    const raw = byPhone[digits];

    console.log(`\n--- ${phone} ---`);

    if (!raw) {
      console.log(`NOT FOUND in JSON by digits key "${digits}"`);
      // Try manual search
      const allKeys = Object.keys(byPhone);
      const close = allKeys.find(k => k.includes(digits.slice(1)) || digits.includes(k.slice(1)));
      console.log(`Close match: ${close || 'none'}`);
      continue;
    }

    const supplier = normalizeSupplierRecord(raw);
    const images = collectSupplierImages(supplier);

    console.log(`Found: ${supplier['Supplier Name']} | images: ${images.length} | reviews: ${(supplier.reviews||[]).length}`);

    // Check if already exists
    const existing = await findExistingVendor(vendors, supplier);
    if (existing) {
      console.log(`Already in DB: ${existing.name} (id: ${existing._id}) — skipping`);
      continue;
    }

    const fiestaData = buildDefaultFiestaData(supplier, {
      type: 'dj',
      agentName: 'ינון',
      agreementSigned: true,
      selectedImages: images,
      images,
      description: description || supplier.description || '',
      reviews: supplier.reviews || [],
    });

    const result = await pushSupplierToFiesta({ vendorsCollection: vendors, supplier, fiestaData });
    console.log(`PUSHED: ${result.status} — id: ${result.vendorId}`);
  }

  // Final count
  const djs = await vendors.find({ type: 'dj' }).project({ name: 1, contact: 1 }).toArray();
  console.log(`\n=== Total DJs in DB: ${djs.length} ===`);
  for (const d of djs) console.log(`  ✅ ${d.name} | ${d.contact}`);

  await client.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
