import { execSync } from 'child_process';
import fs from 'fs';

const log = [];
function run(cmd, cwd) {
  log.push(`> ${cmd}`);
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (output.trim()) log.push(output.trim());
    return true;
  } catch (error) {
    log.push(error.stdout?.toString() || '');
    log.push(error.stderr?.toString() || error.message);
    return false;
  }
}

const scrapingRoot = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta';
const fiestaRoot = 'C:\\Users\\123\\Desktop\\tium_fiesta\\Fiesta\\fiesta-nextjs';
const copyPath = 'C:\\Users\\123\\Desktop\\tium_fiesta\\scarping_for_fiesta - עותק';
const outFile = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta\\deploy-log.txt';

if (fs.existsSync(copyPath)) {
  fs.rmSync(copyPath, { recursive: true, force: true });
  log.push('Deleted copy folder');
} else {
  log.push('Copy folder not found');
}

run('node scripts/fix-pushed-vendors.mjs', scrapingRoot);
run('git add -A', scrapingRoot);
run('git commit -m "Fix suppliers dashboard, push-to-fiesta, and vendor image migration"', scrapingRoot);
run('git push origin main', scrapingRoot);

run('git add -A', fiestaRoot);
run('git commit -m "Resolve vendor images from scraped media paths on live site"', fiestaRoot);
run('git push origin main', fiestaRoot);

fs.writeFileSync(outFile, log.join('\n'));
console.log(log.join('\n'));
