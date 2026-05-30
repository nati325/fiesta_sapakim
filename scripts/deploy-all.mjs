import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scrapingRoot = path.join(__dirname, '..');
const fiestaRoot = 'C:\\Users\\123\\Desktop\\tium_fiesta\\Fiesta\\fiesta-nextjs';
const copyPath = 'C:\\Users\\123\\Desktop\\tium_fiesta\\scarping_for_fiesta - עותק';

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`);
  const output = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (output.trim()) console.log(output.trim());
}

if (fs.existsSync(copyPath)) {
  fs.rmSync(copyPath, { recursive: true, force: true });
  console.log('Deleted duplicate scraping copy folder.');
}

console.log('Fixing pushed vendor images in MongoDB...');
run('node scripts/fix-pushed-vendors.mjs', scrapingRoot);

const scrapingMessage = 'Fix supplier data loading, push-to-fiesta images, and vendor migration';
run('git add -A', scrapingRoot);
try {
  run(`git commit -m "${scrapingMessage}"`, scrapingRoot);
} catch {
  console.log('No scraping changes to commit.');
}
run('git push origin main', scrapingRoot);

const fiestaMessage = 'Resolve vendor images from scraped media paths on live site';
run('git add -A', fiestaRoot);
try {
  run(`git commit -m "${fiestaMessage}"`, fiestaRoot);
} catch {
  console.log('No Fiesta changes to commit.');
}
run('git push origin main', fiestaRoot);

console.log('\nAll done.');
