import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';

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
  process.chdir(projectRoot);
  const crmUri = process.env.MONGODB_URI;
  const fiestaUri = process.env.FIESTA_MONGODB_URI;
  if (!crmUri || !fiestaUri) {
    console.error('Missing MONGODB_URI or FIESTA_MONGODB_URI');
    process.exit(1);
  }

  const { list } = loadSuppliersFromJson();
  const byPhone = new Map();
  for (const s of list) {
    const phone = String(s['Real Phone'] || s.real_phone || s.phone || '').replace(/\D/g, '');
    if (phone) byPhone.set(phone, s);
  }

  const crmClient = new MongoClient(crmUri);
  const fiestaClient = new MongoClient(fiestaUri);
  await crmClient.connect();
  await fiestaClient.connect();

  const states = await crmClient.db('fiesta_crm').collection('supplier_states').find({}).toArray();
  const vendors = await fiestaClient.db('fiesta').collection('vendors').find({}).toArray();

  const vendorNames = new Set(vendors.map((v) => (v.name || '').trim().toLowerCase()));
  const vendorPhones = new Set(
    vendors.map((v) => String(v.contact || '').replace(/\D/g, '')).filter(Boolean)
  );

  const contractStates = states.filter((s) => s.status === 'contract');
  const pending = [];

  for (const st of contractStates) {
    const phoneKey = String(st.phone || '').replace(/\D/g, '');
    const supplier = byPhone.get(phoneKey);
    const name = supplier?.['Supplier Name'] || st.name || phoneKey;
    const nameNorm = String(name).trim().toLowerCase();
    const inFiesta = vendorNames.has(nameNorm) || (phoneKey && vendorPhones.has(phoneKey));
    if (!inFiesta) {
      pending.push({
        phone: st.phone,
        name: supplier?.['Supplier Name'] || name,
        category: supplier?.Category || '',
        agent: st.agent || '',
      });
    }
  }

  const outPath = path.join(projectRoot, 'pending-fiesta-push.json');
  fs.writeFileSync(outPath, JSON.stringify({ count: pending.length, pending }, null, 2), 'utf8');
  console.log(`Contract suppliers not in Fiesta: ${pending.length}`);
  pending.forEach((p, i) => console.log(`${i + 1}. ${p.name} | ${p.phone} | ${p.category} | agent: ${p.agent}`));
  console.log(`Written to ${outPath}`);

  await crmClient.close();
  await fiestaClient.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
