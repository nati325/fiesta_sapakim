import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';
import { supplierMatchesSearch } from '../lib/searchUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'verify-dashboard-report.txt');
const lines = [];

function log(...args) {
  lines.push(args.map(String).join(' '));
}

const { list } = loadSuppliersFromJson(root);
log('=== SUPPLIER DASHBOARD VERIFICATION ===');
log('Total loaded:', list.length);

const emptyNames = list.filter((s) => {
  const name = (s['Supplier Name'] || '').trim();
  return !name || name === 'ספק ללא שם';
});
log('Empty names:', emptyNames.length);

const phoneMap = new Map();
const dupes = [];
for (const s of list) {
  const key = String(s['Real Phone'] || '').replace(/\D/g, '');
  if (!key) continue;
  if (phoneMap.has(key)) dupes.push(key);
  else phoneMap.set(key, s['Supplier Name']);
}
log('Duplicate phones after dedupe:', dupes.length);

const lior = list.find(
  (s) =>
    (s['Supplier Name'] || '').includes('ליאור פרץ') ||
    (s.clean_name || '').includes('ליאור פרץ')
);
log('\n--- LIOR PEREZ ---');
log('Found:', !!lior);
if (lior) {
  log('Name:', lior['Supplier Name']);
  log('Clean name:', lior.clean_name);
  log('Category:', lior.Category);
  log('Real Phone:', lior['Real Phone']);
  log('Index (1-based):', list.indexOf(lior) + 1);
  log('Search "ליאור פרץ":', supplierMatchesSearch(lior, 'ליאור פרץ', list.indexOf(lior) + 1));
  log('Search "ליאר פרץ":', supplierMatchesSearch(lior, 'ליאר פרץ', list.indexOf(lior) + 1));
  log('Search "407":', supplierMatchesSearch(lior, '407', list.indexOf(lior) + 1));
}

const yinonCats = ['מוזיקה', "די ג'יי", 'DJ', "דיג'יי", 'תקליטן'];
const yinonSuppliers = list.filter((s) => {
  const cat = s.Category || '';
  if (!cat || cat === 'ספקים ללא קטגוריה') return true;
  return yinonCats.some((c) => cat.includes(c));
});
log('\n--- YINON FILTER ---');
log('Visible to Yinon:', yinonSuppliers.length);
log('Lior visible to Yinon:', yinonSuppliers.some((s) => (s['Supplier Name'] || '').includes('ליאור פרץ')));

const noImage = list.filter((s) => !(s.images?.length || s['Main Image'] || s['Google Image']));
log('\n--- IMAGES ---');
log('Without any image URL:', noImage.length);
log('With http image:', list.filter((s) => (s.images || []).some((i) => String(i).startsWith('http'))).length);

log('\n--- SAMPLE EMPTY-LIKE (first 5 with short name) ---');
list
  .filter((s) => (s['Supplier Name'] || '').length < 3)
  .slice(0, 5)
  .forEach((s) => log(s.id, s['Supplier Name'], s['Real Phone']));

log('\n--- BAD SEARCH TEST: query "40" should NOT match everyone ---');
const badSearch40 = list.filter((s, i) => supplierMatchesSearch(s, '40', i + 1));
log('Matches for "40":', badSearch40.length);

log('\n--- GOOD SEARCH TEST: query "ליאר פרץ" ---');
const goodSearch = list.filter((s, i) => supplierMatchesSearch(s, 'ליאר פרץ', i + 1));
log('Matches for "ליאר פרץ":', goodSearch.length);
goodSearch.slice(0, 5).forEach((s) => log(' -', s['Supplier Name']));

fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log('Report written to', outPath);
lines.forEach((l) => console.log(l));
