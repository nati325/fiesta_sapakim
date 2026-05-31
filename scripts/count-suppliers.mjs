import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(path.join(root, 'data', 'suppliers_complete.json'), 'utf8'));
const { list } = loadSuppliersFromJson(root);

const noPhone = raw.filter((s) => !(s.real_phone || s.phone || '').trim());
const dupPhones = new Map();
raw.forEach((s) => {
  const p = (s.real_phone || s.phone || '').replace(/\D/g, '');
  if (!p) return;
  dupPhones.set(p, (dupPhones.get(p) || 0) + 1);
});
const duplicateGroups = [...dupPhones.entries()].filter(([, c]) => c > 1);

console.log('JSON records:        ', raw.length);
console.log('After load (deduped):', list.length);
console.log('Removed total:       ', raw.length - list.length);
console.log('No phone at all:     ', noPhone.length);
console.log('Duplicate phone keys:', duplicateGroups.length, '(accounts for', duplicateGroups.reduce((a, [, c]) => a + c - 1, 0), 'extra rows)');
if (noPhone.length) {
  console.log('\nExamples without phone:');
  noPhone.slice(0, 5).forEach((s) => console.log(' -', s.clean_name || s.name));
}
if (duplicateGroups.length) {
  console.log('\nExamples duplicate phones:');
  duplicateGroups.slice(0, 5).forEach(([phone, count]) => {
    const names = raw.filter((s) => (s.real_phone || s.phone || '').replace(/\D/g, '') === phone).map((s) => s.clean_name || s.name);
    console.log(` - ${phone} (${count}x):`, names.join(' | '));
  });
}
