import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const jsonPath = path.join(root, 'data', 'suppliers_complete.json');
if (fs.existsSync(jsonPath)) {
  let content = fs.readFileSync(jsonPath, 'utf8');
  if (content.includes('<<<<<<<')) {
    content = content.replace(
      /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n[\s\S]*?>>>>>>> origin\/main\r?\n/g,
      '$1'
    );
    fs.writeFileSync(jsonPath, content, 'utf8');
    console.log('Repaired suppliers_complete.json');
  }
}

const descPath = path.join(root, 'data', 'supplier_descriptions.json');
if (fs.existsSync(descPath)) {
  let content = fs.readFileSync(descPath, 'utf8');
  if (content.includes('<<<<<<<')) {
    content = content.replace(
      /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n[\s\S]*?>>>>>>> origin\/main\r?\n/g,
      '$1'
    );
    fs.writeFileSync(descPath, content, 'utf8');
    console.log('Repaired supplier_descriptions.json');
  }
}

const { list } = loadSuppliersFromJson(root);
console.log(`Loaded ${list.length} suppliers OK`);
const emptyNames = list.filter((s) => !(s['Supplier Name'] || '').trim() || s['Supplier Name'] === 'ספק ללא שם');
console.log(`Empty names: ${emptyNames.length}`);
const lior = list.find((s) => (s['Supplier Name'] || '').includes('ליאור פרץ') || (s.clean_name || '').includes('ליאור פרץ'));
console.log('Lior Perez found:', !!lior, lior?.['Supplier Name'], lior?.['Real Phone']);
console.log('Sample:', list[0]?.['Supplier Name'], list[0]?.['Real Phone'], list[0]?.images?.[0] || 'no image');
