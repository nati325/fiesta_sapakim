/**
 * reset-djs.mjs
 * 1. Delete ALL type='dj' vendors from Fiesta MongoDB
 * 2. Re-push 6 DJs with full images, reviews, description
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../lib/supplierEnrichment.js';
import { buildDefaultFiestaData, pushSupplierToFiesta } from '../lib/fiestaPushCore.js';
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

// ============================================================
// DJs to push — with custom descriptions
// ============================================================
const DJ_PHONES = [
  { phone: '052-3300403', description: 'ליאור פרץ — Full Volume | דיגיי לחתונות ואירועים. סאונד מקצועי, אווירה בלתי נשכחת.' },
  { phone: '054-4850419', description: 'שרון כהן — DJ מקצועי לחתונות ואירועים. ניסיון רב, מוזיקה לכל טעם.' },
  { phone: '052-4235911', description: 'DJ Moshe B — דיגיי משה בי | מוזיקה חיה, אנרגיה גבוהה לחתונות ואירועים.' },
  { phone: '058-4474558', description: 'אליהו ידגרוב — Dj Eliyahu Yadgarov | דיגיי מקצועי לחתונות ואירועי שמחה.' },
  { phone: '050-7984019', description: 'ישראל ישראלוב — DJ Easy Israel | הדיגיי שיגרום לחתונה שלכם להיות בלתי נשכחת.' },
  { phone: '052-3586868', description: 'אקפלה — Acapella תקליטנים | יובל ענבר. תקליטנות ברמה הגבוהה ביותר לחתונות.' },
];

async function main() {
  process.chdir(projectRoot);

  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) {
    console.error('❌ ERROR: FIESTA_MONGODB_URI missing in .env.local');
    process.exit(1);
  }

  console.log('🔌 Connecting to Fiesta MongoDB...');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  // ── Step 1: Delete ALL type='dj' vendors ──
  const before = await vendors.countDocuments({ type: 'dj' });
  console.log(`\n🗑️  Deleting ${before} existing DJ vendor(s)...`);
  const deleteResult = await vendors.deleteMany({ type: 'dj' });
  console.log(`✅ Deleted: ${deleteResult.deletedCount}`);

  // ── Step 2: Load suppliers data ──
  console.log('\n📂 Loading suppliers from JSON...');
  const { byPhone } = loadSuppliersFromJson(projectRoot);
  console.log(`   Loaded ${Object.keys(byPhone).length} suppliers`);

  // ── Step 3: Push each DJ ──
  const results = [];
  for (const { phone, description } of DJ_PHONES) {
    const digits = phoneKey(phone);
    const raw = byPhone[digits];

    if (!raw) {
      console.log(`\n⚠️  NOT FOUND in JSON: ${phone} — skipping`);
      results.push({ phone, status: 'not_found_in_json' });
      continue;
    }

    const supplier = normalizeSupplierRecord(raw);
    const images = collectSupplierImages(supplier);

    const fiestaData = buildDefaultFiestaData(supplier, {
      type: 'dj',
      agentName: 'reset-djs',
      agreementSigned: true,
      selectedImages: images,
      images,
      description: description || supplier.description || '',
      reviews: supplier.reviews || [],
    });

    console.log(`\n➡️  Pushing: ${supplier['Supplier Name']} | ${phone} | ${images.length} images | ${(supplier.reviews || []).length} reviews`);

    try {
      const result = await pushSupplierToFiesta({ vendorsCollection: vendors, supplier, fiestaData });
      console.log(`   ✅ ${result.status} — id: ${result.vendorId}`);
      results.push({ phone, name: supplier['Supplier Name'], status: result.status, images: images.length });
    } catch (e) {
      console.error(`   ❌ ERROR: ${e.message}`);
      results.push({ phone, status: 'error', error: e.message });
    }
  }

  // ── Summary ──
  console.log('\n══════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('══════════════════════════════════');
  const after = await vendors.countDocuments({ type: 'dj' });
  console.log(`   DJs in DB after: ${after}`);
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'not_found_in_json' ? '⚠️' : '❌';
    console.log(`   ${icon} ${r.phone} — ${r.name || r.status} (${r.images ?? ''} images)`);
  }

  // ── Also delete leftover garbage records (type=design, phone-as-name) ──
  console.log('\n🧹 Cleaning up any leftover garbage records...');
  const garbage = await vendors.find({
    $or: [
      { name: { $regex: '^0[0-9]{9}$' } },
      { name: { $regex: '^0[0-9]{2}-[0-9]{7}$' } },
      { name: 'ליאור פרץ', type: 'design' },
    ]
  }).toArray();
  if (garbage.length) {
    const del = await vendors.deleteMany({ _id: { $in: garbage.map(g => g._id) } });
    console.log(`   Removed ${del.deletedCount} garbage record(s)`);
  } else {
    console.log('   No garbage records found ✓');
  }

  await client.close();
  console.log('\n🎉 Done! DJs are ready in Fiesta DB.');
  console.log('   Now start Fiesta on localhost:3001 and check /category/dj');
}

main().catch((e) => {
  console.error('\n❌ FATAL:', e.message);
  process.exit(1);
});
