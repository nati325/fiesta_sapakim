import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function readMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return null;
  const match = fs.readFileSync(envPath, 'utf-8').match(/MONGODB_URI="([^"]+)"/);
  return match?.[1] || null;
}

const { list } = loadSuppliersFromJson(root);
const validPhones = new Set(
  list.map((s) => String(s['Real Phone'] || '').replace(/\D/g, '')).filter(Boolean)
);

const mongoUri = readMongoUri();
if (!mongoUri) {
  console.error('No MONGODB_URI found');
  process.exit(1);
}

const client = new MongoClient(mongoUri);
await client.connect();
const collection = client.db('fiesta_crm').collection('supplier_states');

const allStates = await collection.find({}).toArray();
const orphanPhones = allStates
  .map((doc) => doc.phone)
  .filter((phone) => {
    const key = String(phone || '').replace(/\D/g, '');
    return key && !validPhones.has(key);
  });

console.log(`Valid suppliers: ${validPhones.size}`);
console.log(`Orphan MongoDB states to remove: ${orphanPhones.length}`);

if (orphanPhones.length > 0) {
  const result = await collection.deleteMany({ phone: { $in: orphanPhones } });
  console.log(`Deleted ${result.deletedCount} orphan state records`);
}

await client.close();
console.log('Done');
