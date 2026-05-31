import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

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

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

async function main() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) { console.error('FIESTA_MONGODB_URI missing'); process.exit(1); }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  // Find Sharon by phone digits
  const sharon = await vendors.findOne({ contact: { $regex: '0544850419' } });

  if (!sharon) {
    // Try by name
    const byName = await vendors.findOne({ name: { $regex: 'שרון כהן', $options: 'i' } });
    if (!byName) {
      console.log('Sharon not found in DB at all!');
      await client.close();
      return;
    }
    console.log(`Found by name: "${byName.name}" | type: ${byName.type} | contact: ${byName.contact}`);
    const res = await vendors.updateOne({ _id: byName._id }, { $set: { type: 'dj' } });
    console.log(`Updated type to dj: ${res.modifiedCount} record(s)`);
  } else {
    console.log(`Found: "${sharon.name}" | type: ${sharon.type} | contact: ${sharon.contact}`);
    if (sharon.type === 'dj') {
      console.log('Already type=dj, nothing to do.');
    } else {
      const res = await vendors.updateOne({ _id: sharon._id }, { $set: { type: 'dj' } });
      console.log(`Updated type from "${sharon.type}" to "dj": ${res.modifiedCount} record(s)`);
    }
  }

  // Final count
  const djs = await vendors.find({ type: 'dj' }).project({ name: 1, contact: 1 }).toArray();
  console.log(`\n=== Total DJs now: ${djs.length} ===`);
  for (const d of djs) console.log(`  ✅ ${d.name} | ${d.contact}`);

  await client.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
