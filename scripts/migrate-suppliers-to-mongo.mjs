/**
 * Migrate suppliers_complete.json → MongoDB fiesta_crm.suppliers
 *
 * Usage:
 *   node scripts/migrate-suppliers-to-mongo.mjs
 *   node scripts/migrate-suppliers-to-mongo.mjs --force   # re-upsert all
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  bulkUpsertSuppliers,
  countSuppliersInMongo,
  ensureSupplierIndexes,
  getSuppliersCollection,
  jsonItemToMongoDoc,
} from '../lib/suppliersMongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, '../data/suppliers_complete.json');
const FORCE = process.argv.includes('--force');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv(path.join(__dirname, '..', '.env.local'));

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing — set in .env.local');
    process.exit(1);
  }

  if (!fs.existsSync(JSON_PATH)) {
    console.error('Missing:', JSON_PATH);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  if (!Array.isArray(raw)) {
    console.error('Invalid JSON array');
    process.exit(1);
  }

  const existingCount = await countSuppliersInMongo();
  console.log(`MongoDB suppliers before: ${existingCount}`);
  console.log(`JSON records: ${raw.length}`);

  if (existingCount > 0 && !FORCE) {
    console.log('Collection already has data. Use --force to re-sync from JSON.');
    process.exit(0);
  }

  const col = await getSuppliersCollection();
  console.log('Cleaning legacy records without phoneKey...');
  await col.deleteMany({});
  await ensureSupplierIndexes(col);

  const docs = raw.map(jsonItemToMongoDoc).filter(Boolean);
  console.log(`Valid docs to upsert: ${docs.length}`);

  const result = await bulkUpsertSuppliers(docs);
  const after = await countSuppliersInMongo();

  console.log('\n=== Migration complete ===');
  console.log(`Upserted: ${result.upserted}`);
  console.log(`Modified: ${result.modified}`);
  console.log(`MongoDB suppliers after: ${after}`);

  const sample = await col.find({}).project({ name: 1, category: 1, real_phone: 1 }).limit(3).toArray();
  console.log('\nSample:', sample);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
