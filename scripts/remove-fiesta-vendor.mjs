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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function phoneKey(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseArgs(argv) {
  const args = { phone: null, name: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--phone' && argv[i + 1]) args.phone = argv[++i];
    else if (argv[i] === '--name' && argv[i + 1]) args.name = argv[++i];
  }
  return args;
}

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

async function main() {
  process.chdir(projectRoot);
  const { phone, name } = parseArgs(process.argv);
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) {
    console.error('ERROR: FIESTA_MONGODB_URI missing');
    process.exit(1);
  }
  if (!phone && !name) {
    console.error('Usage: node scripts/remove-fiesta-vendor.mjs --phone 052-538-8833');
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  const or = [];
  if (phone) {
    const digits = phoneKey(phone);
    or.push({ contact: { $regex: digits } });
  }
  if (name) {
    or.push({ name: { $regex: name, $options: 'i' } });
  }

  const matches = await vendors.find({ $or: or }).toArray();
  if (!matches.length) {
    console.log('NOT_FOUND');
    await client.close();
    process.exit(0);
  }

  for (const doc of matches) {
    console.log('FOUND:', doc.name, '|', doc.contact, '| id:', doc._id);
  }

  const result = await vendors.deleteMany({ _id: { $in: matches.map((m) => m._id) } });
  console.log('DELETED:', result.deletedCount);
  await client.close();
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
