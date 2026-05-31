import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'lior-diagnosis.txt');
const lines = [];

function log(...args) {
  lines.push(args.map(String).join(' '));
}

const { list } = loadSuppliersFromJson(root);
const lior = list.find((s) => (s['Supplier Name'] || '').includes('ליאור פרץ'));
const idx = list.findIndex((s) => (s['Supplier Name'] || '').includes('ליאור פרץ'));

log('Total suppliers loaded:', list.length);
log('Lior index in list (1-based):', idx >= 0 ? idx + 1 : 'NOT FOUND');
log('Lior found:', !!lior);

if (lior) {
  log('Name:', lior['Supplier Name']);
  log('Category:', lior.Category);
  log('Real Phone:', lior['Real Phone']);
  log('Images:', JSON.stringify(lior.images));
}

const envPath = path.join(root, '.env.local');
let mongoUri = process.env.MONGODB_URI;
if (!mongoUri && fs.existsSync(envPath)) {
  const m = fs.readFileSync(envPath, 'utf-8').match(/MONGODB_URI="([^"]+)"/);
  if (m) mongoUri = m[1];
}

if (mongoUri && lior) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db('fiesta_crm');
    const phone = lior['Real Phone'];
    const state = await db.collection('supplier_states').findOne({ phone });
    log('MongoDB state for', phone + ':', state ? JSON.stringify(state, null, 2) : 'none');
  } finally {
    await client.close();
  }
} else {
  log('Skipped MongoDB (no URI or no Lior)');
}

fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log('Wrote', outPath);
