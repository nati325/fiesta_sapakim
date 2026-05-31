import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prepareFiestaImage } from '../lib/fiestaImages.js';
import { collectSupplierImages } from '../lib/fiestaCategoryMap.js';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../lib/supplierEnrichment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const outFile = path.join(projectRoot, 'verify-push-report.txt');

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

async function main() {
  process.chdir(projectRoot);
  loadEnvFile(path.join(projectRoot, '.env.local'));
  loadEnvFile(path.join(projectRoot, '.env'));

  const origin = process.env.SCRAPING_PUBLIC_URL || 'https://fiesta-sapakim.vercel.app';
  const { list } = loadSuppliersFromJson();
  const supplier = normalizeSupplierRecord(list[0]);
  const images = collectSupplierImages(supplier).slice(0, 3);
  const prepared = [];

  for (const img of images) {
    prepared.push({ raw: img, resolved: await prepareFiestaImage(img, origin) });
  }

  const report = [
    `Supplier: ${supplier['Supplier Name']}`,
    `Origin: ${origin}`,
    `FIESTA_MONGODB_URI: ${process.env.FIESTA_MONGODB_URI ? 'set' : 'MISSING'}`,
    `CLOUDINARY: ${process.env.CLOUDINARY_CLOUD_NAME ? 'set' : 'not set'}`,
    '',
    'Image resolution:',
    ...prepared.map((row) => `  ${row.raw}\n  -> ${row.resolved || '(empty)'}`),
  ].join('\n');

  fs.writeFileSync(outFile, report, 'utf8');
  console.log(report);
}

main().catch((error) => {
  const msg = `ERROR: ${error.message}`;
  fs.writeFileSync(outFile, msg, 'utf8');
  console.error(msg);
  process.exit(1);
});
