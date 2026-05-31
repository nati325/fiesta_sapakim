import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../lib/supplierEnrichment.js';
import { buildDefaultFiestaData, pushSupplierToFiesta } from '../lib/fiestaPushCore.js';
import { collectSupplierImages } from '../lib/fiestaCategoryMap.js';

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
  const args = { contract: false, file: null, phones: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--contract') args.contract = true;
    else if (arg === '--file' && argv[i + 1]) args.file = argv[++i];
    else if (arg === '--phone' && argv[i + 1]) args.phones.push(argv[++i]);
  }
  return args;
}

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

async function main() {
  process.chdir(projectRoot);
  const args = parseArgs(process.argv);
  const fiestaUri = process.env.FIESTA_MONGODB_URI;
  const crmUri = process.env.MONGODB_URI;

  if (!fiestaUri) {
    console.error('Missing FIESTA_MONGODB_URI');
    process.exit(1);
  }

  const { list } = loadSuppliersFromJson();
  const byPhone = new Map();
  for (const raw of list) {
    const supplier = normalizeSupplierRecord(raw);
    const key = phoneKey(supplier['Real Phone'] || supplier.phone);
    if (key) byPhone.set(key, supplier);
  }

  let queue = [];
  if (args.file) {
    const filePath = path.isAbsolute(args.file) ? args.file : path.join(projectRoot, args.file);
    queue = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } else if (args.phones.length) {
    queue = args.phones.map((phone) => ({ phone }));
  } else if (args.contract) {
    if (!crmUri) {
      console.error('Missing MONGODB_URI for --contract');
      process.exit(1);
    }
    const crmClient = new MongoClient(crmUri);
    await crmClient.connect();
    const states = await crmClient
      .db('fiesta_crm')
      .collection('supplier_states')
      .find({ status: 'contract' })
      .toArray();
    await crmClient.close();
    queue = states.map((s) => ({ phone: s.phone, agentName: s.agent || 'bulk-push' }));
  } else {
    console.log('Usage:');
    console.log('  node scripts/bulk-push-to-fiesta.mjs --contract');
    console.log('  node scripts/bulk-push-to-fiesta.mjs --phone 052-3300403 --phone ...');
    console.log('  node scripts/bulk-push-to-fiesta.mjs --file data/fiesta-push-queue.json');
    process.exit(1);
  }

  const fiestaClient = new MongoClient(fiestaUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  await fiestaClient.connect();
  const vendors = fiestaClient.db('fiesta').collection('vendors');

  const results = [];
  for (const item of queue) {
    const supplier = byPhone.get(phoneKey(item.phone));
    if (!supplier) {
      results.push({ phone: item.phone, status: 'error', error: 'supplier not found in JSON' });
      continue;
    }

    const images = collectSupplierImages(supplier);
    const fiestaData = buildDefaultFiestaData(supplier, {
      ...item,
      selectedImages: item.selectedImages || images,
      images: item.selectedImages || images,
      agentName: item.agentName || 'bulk-push',
      agreementSigned: item.agreementSigned ?? true,
    });

    try {
      const result = await pushSupplierToFiesta({
        vendorsCollection: vendors,
        supplier,
        fiestaData,
        origin: process.env.SCRAPING_PUBLIC_URL || 'https://fiesta-sapakim.vercel.app',
      });
      results.push({
        name: supplier['Supplier Name'],
        phone: supplier['Real Phone'] || supplier.phone,
        ...result,
      });
      console.log(`${result.status.toUpperCase()}: ${supplier['Supplier Name']}`);
    } catch (error) {
      results.push({
        name: supplier['Supplier Name'],
        phone: supplier['Real Phone'] || supplier.phone,
        status: 'error',
        error: error.message,
      });
      console.log(`ERROR: ${supplier['Supplier Name']} — ${error.message}`);
    }
  }

  await fiestaClient.close();

  const summary = {
    requested: queue.length,
    success: results.filter((r) => r.status === 'success').length,
    exists: results.filter((r) => r.status === 'exists').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };

  const outPath = path.join(projectRoot, 'bulk-push-report.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('\nSummary:', summary);
  console.log('Report:', outPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
