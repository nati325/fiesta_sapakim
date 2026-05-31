import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';

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

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

async function main() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) { console.error('FIESTA_MONGODB_URI missing'); process.exit(1); }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  console.log('\n=== ALL VENDORS IN FIESTA DB ===');
  const all = await vendors.find({}).project({ name: 1, contact: 1, type: 1, createdAt: 1, image: 1 }).sort({ createdAt: -1 }).toArray();
  console.log(`Total: ${all.length}`);
  for (const v of all) {
    const hasImage = v.image ? '📸' : '❌';
    console.log(`  ${hasImage} [${v.type}] ${v.name} | ${v.contact || 'no phone'} | ${v.createdAt ? new Date(v.createdAt).toISOString().slice(0,16) : 'no date'} | id:${v._id}`);
  }

  // Identify garbage records: type='design' AND (no image OR name looks like a phone number)
  const garbageIds = [];
  for (const v of all) {
    const nameIsPhone = /^\d{3}[-\s]?\d{7}$|^\d{10}$/.test((v.name || '').trim());
    const isGarbage = nameIsPhone || (!v.image && v.type === 'design' && (v.name === 'ליאור פרץ'));
    if (isGarbage) {
      console.log(`\n🗑️  GARBAGE: ${v.name} | ${v.contact} | id:${v._id}`);
      garbageIds.push(v._id);
    }
  }

  if (garbageIds.length === 0) {
    console.log('\n✅ No garbage records found.');
    await client.close();
    return;
  }

  console.log(`\nDeleting ${garbageIds.length} garbage records...`);
  const result = await vendors.deleteMany({ _id: { $in: garbageIds } });
  console.log(`✅ Deleted: ${result.deletedCount}`);

  console.log('\n=== REMAINING DJs ===');
  const djs = await vendors.find({ type: 'dj' }).project({ name: 1, contact: 1, createdAt: 1 }).sort({ createdAt: -1 }).toArray();
  console.log(`DJ count: ${djs.length}`);
  for (const d of djs) {
    console.log(`  ✅ ${d.name} | ${d.contact}`);
  }

  await client.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
