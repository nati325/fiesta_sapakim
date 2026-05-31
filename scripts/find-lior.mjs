import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';

const { list } = loadSuppliersFromJson();
const lior = list.find((s) => (s['Supplier Name'] || '').includes('ליאור פרץ'));
console.log('Total loaded:', list.length);
console.log('Lior found:', !!lior);
if (lior) {
  console.log(JSON.stringify(lior, null, 2));
}
