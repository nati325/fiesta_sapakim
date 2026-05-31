import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const log = [];

function run(cmd) {
  log.push(`> ${cmd}`);
  try {
    const out = execSync(cmd, { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1024 * 1024 * 200 });
    if (out.trim()) log.push(out.trim());
    return true;
  } catch (error) {
    log.push(error.stdout?.toString() || '');
    log.push(error.stderr?.toString() || error.message);
    return false;
  }
}

function restoreOurs(relPath) {
  const full = path.join(root, relPath);
  try {
    const content = execSync(`git show :2:"${relPath.replace(/\\/g, '/')}"`, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 200,
    });
    fs.writeFileSync(full, content, 'utf8');
    log.push(`Restored ours: ${relPath}`);
    return true;
  } catch {
    try {
      const content = execSync(`git show HEAD:"${relPath.replace(/\\/g, '/')}"`, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 200,
      });
      fs.writeFileSync(full, content, 'utf8');
      log.push(`Restored HEAD: ${relPath}`);
      return true;
    } catch (error) {
      log.push(`Failed restoring ${relPath}: ${error.message}`);
      return false;
    }
  }
}

restoreOurs('data/suppliers_complete.json');
restoreOurs('data/supplier_descriptions.json');

run('git add -A');
run('git commit -m "Resolve merge conflicts and apply supplier/image fixes"');
run('git push origin main');

fs.writeFileSync(path.join(root, 'finish-merge-log.txt'), log.join('\n'), 'utf8');
console.log(log.join('\n'));
