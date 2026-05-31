import fs from 'fs';
import path from 'path';

const compiled = path.join('.next', 'server', 'app', 'api', 'suppliers', 'route.js');

if (fs.existsSync(compiled)) {
  const content = fs.readFileSync(compiled, 'utf-8');
  const usesOldCsv =
    content.includes('engaged_suppliers_final_production.csv') &&
    !content.includes('loadSuppliersFromJson');
  const missingJsonHeader = !content.includes('X-Suppliers-Source');

  if (usesOldCsv || missingJsonHeader) {
    console.log('[ensure-fresh-api] Stale .next cache detected — removing .next ...');
    fs.rmSync('.next', { recursive: true, force: true });
    console.log('[ensure-fresh-api] Done. Next.js will rebuild with the JSON suppliers API.');
  }
}
