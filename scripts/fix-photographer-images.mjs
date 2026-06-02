/**
 * Removes wrong engaged sidebar images from photographers and puts local/Google/social first.
 *
 * Run: node scripts/fix-photographer-images.mjs
 * Apply: node scripts/fix-photographer-images.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isBadEngagedImage,
  pickBestStoredImage,
  reorderSupplierImages,
} from '../lib/supplierImageSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, '..', 'data', 'suppliers_complete.json');
const photoCats = ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל'];
const apply = process.argv.includes('--apply');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
let changed = 0;
let badRemoved = 0;

const updated = data.map((supplier) => {
  const category = (supplier.Category || supplier.category || '').toLowerCase();
  const isPhotographer = photoCats.some((part) => category.includes(part));
  if (!isPhotographer) return supplier;

  const beforeImages = [...(supplier.images || [])];
  const fixed = reorderSupplierImages(supplier);
  const afterImages = fixed.images || [];

  const removedBad = beforeImages.filter((item) => isBadEngagedImage(item)).length;
  if (removedBad) badRemoved += removedBad;

  const beforeBest = pickBestStoredImage(supplier);
  const afterBest = pickBestStoredImage(fixed);
  const same =
    JSON.stringify(beforeImages) === JSON.stringify(afterImages) &&
    beforeBest === afterBest;

  if (!same) {
    changed += 1;
    console.log(`✓ ${supplier.name || supplier['Supplier Name']}`);
    if (beforeBest !== afterBest) {
      console.log(`  before: ${String(beforeBest || 'none').slice(0, 80)}`);
      console.log(`  after:  ${String(afterBest || 'none').slice(0, 80)}`);
    }
  }

  return fixed;
});

console.log(`\nPhotographers fixed: ${changed}`);
console.log(`Bad engaged URLs removed: ${badRemoved}`);

if (apply) {
  fs.writeFileSync(jsonPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
  console.log(`Saved ${jsonPath}`);
} else {
  console.log('\nDry run only. Re-run with --apply to save.');
}
