import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'verify-fiesta-djs.txt');
const lines = [];

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

const scrapingRoot = path.join(__dirname, '..');
const fiestaRoot = path.join('C:', 'Users', '123', 'Desktop', 'tium_fiesta', 'Fiesta', 'fiesta-nextjs');
loadEnv(path.join(scrapingRoot, '.env.local'));
loadEnv(path.join(fiestaRoot, '.env'));

const targets = [
  { label: 'PUSH (FIESTA_MONGODB_URI)', uri: process.env.FIESTA_MONGODB_URI },
  { label: 'FIESTA SITE (.env MONGODB_URI)', uri: process.env.MONGODB_URI },
];

const pushedPhones = ['0523300403', '0544850419', '0524235911', '0584474558', '0507984019', '0523586868'];

async function inspect(label, uri) {
  lines.push(`\n=== ${label} ===`);
  if (!uri) {
    lines.push('MISSING URI');
    return;
  }
  lines.push(`URI host: ${uri.replace(/\/\/[^:]+:[^@]+@/, '//***@').slice(0, 120)}...`);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12000 });
  try {
    await client.connect();
    const dbName = new URL(uri.replace('mongodb+srv://', 'https://')).pathname.replace(/^\//, '').split('?')[0] || 'fiesta';
    const vendors = client.db(dbName).collection('vendors');
    const total = await vendors.countDocuments({});
    const djs = await vendors.countDocuments({ type: 'dj' });
    lines.push(`DB: ${dbName} | total vendors: ${total} | type=dj: ${djs}`);

    const recent = await vendors.find({ type: 'dj' }).sort({ createdAt: -1 }).limit(15).project({ name: 1, contact: 1, type: 1, createdAt: 1 }).toArray();
    lines.push('Recent DJs:');
    for (const v of recent) {
      lines.push(`  - ${v.name} | ${v.contact || 'no phone'} | ${v.createdAt ? new Date(v.createdAt).toISOString().slice(0, 10) : 'no date'}`);
    }

    lines.push('Expected pushed phones:');
    for (const phone of pushedPhones) {
      const found = await vendors.findOne({ contact: { $regex: phone } });
      lines.push(`  ${phone}: ${found ? 'YES - ' + found.name : 'NO'}`);
    }
  } catch (e) {
    lines.push(`ERROR: ${e.message}`);
  } finally {
    await client.close().catch(() => {});
  }
}

for (const t of targets) {
  await inspect(t.label, t.uri);
}

fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
