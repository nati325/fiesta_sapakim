import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../lib/supplierEnrichment.js';
import { buildDefaultFiestaData, findExistingVendor, pushSupplierToFiesta } from '../lib/fiestaPushCore.js';
import { collectSupplierImages } from '../lib/fiestaCategoryMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const PHONE = '054-4850419';

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
    console.error('ERROR: FIESTA_MONGODB_URI missing');
    process.exit(1);
  }

  const { list } = loadSuppliersFromJson();
  const raw = list.find((s) => phoneKey(s['Real Phone'] || s.real_phone || s.phone) === phoneKey(PHONE));
  if (!raw) {
    console.error('ERROR: Sharon Cohen not found in JSON');
    process.exit(1);
  }

  const supplier = normalizeSupplierRecord(raw);
  const images = collectSupplierImages(supplier);
  const djDescription =
    'DJ שרון כהן — 22 שנות ניסיון בחתונות ואירועים. מוזיקה מקפיצה, רמיקסים איכותיים ושליטה מלאה על הרחבה.';

  const fiestaData = buildDefaultFiestaData(supplier, {
    type: 'dj',
    agentName: 'ינון',
    agreementSigned: true,
    selectedImages: images,
    images,
    description: djDescription,
    region: 'רחובות',
  });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  const existing = await findExistingVendor(vendors, supplier);
  if (existing) {
    await vendors.updateOne(
      { _id: existing._id },
      {
        $set: {
          type: 'dj',
          description: djDescription,
          region: fiestaData.region || existing.region,
          contact: supplier['Real Phone'] || supplier.phone || existing.contact,
          image: fiestaData.image || existing.image,
          agreementSigned: true,
          adminNotes: `${existing.adminNotes || ''}\n🔄 עודכן ל-DJ אוטומטית (${new Date().toISOString()})`.trim(),
        },
      }
    );
    const report = { status: 'updated', vendorId: existing._id, name: existing.name, fiestaType: 'dj' };
    fs.writeFileSync(path.join(projectRoot, 'bulk-push-report.json'), JSON.stringify(report, null, 2));
    console.log('UPDATED:', JSON.stringify(report, null, 2));
    await client.close();
    return;
  }

  const result = await pushSupplierToFiesta({ vendorsCollection: vendors, supplier, fiestaData });
  await client.close();
  const report = { ...result, phone: PHONE, fiestaType: 'dj' };
  fs.writeFileSync(path.join(projectRoot, 'bulk-push-report.json'), JSON.stringify(report, null, 2));
  console.log('SUCCESS:', JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
