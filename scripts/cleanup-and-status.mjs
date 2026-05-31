/**
 * cleanup-and-status.mjs
 * Deletes garbage phone-as-name records and prints DB status
 */
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

  // Delete garbage: name is a phone number (with or without dash, with or without suffix like " CHECK")
  const garbage = await vendors.find({
    name: { $regex: '^0[0-9]{2}[-]?[0-9]{7}' }
  }).toArray();

  if (garbage.length > 0) {
    console.log(`\n🗑️  Deleting ${garbage.length} garbage records (phone-as-name):`);
    for (const g of garbage) console.log(`   - "${g.name}" | ${g.contact} | type:${g.type}`);
    const del = await vendors.deleteMany({ _id: { $in: garbage.map(g => g._id) } });
    console.log(`   ✅ Deleted: ${del.deletedCount}`);
  } else {
    console.log('\n✅ No garbage records found.');
  }

  // Print all current DJs
  const djs = await vendors.find({ type: 'dj' }).sort({ createdAt: -1 }).toArray();
  console.log(`\n══════════════════════════════════`);
  console.log(`📊 DJs in Fiesta DB: ${djs.length}`);
  console.log(`══════════════════════════════════`);
  for (const d of djs) {
    const imgs = d.portfolio?.length || 0;
    const reviews = d.reviews?.length || 0;
    const hasImage = d.image ? '📸' : '❌';
    console.log(`  ${hasImage} ${d.name}`);
    console.log(`     phone: ${d.contact} | images: ${imgs} | reviews: ${reviews} | date: ${d.createdAt?.toISOString?.()?.slice(0,10) || 'N/A'}`);
  }

  const total = await vendors.countDocuments({});
  console.log(`\nTotal vendors in DB: ${total}`);
  await client.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
