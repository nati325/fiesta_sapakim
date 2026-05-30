import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const logFile = path.join(root, 'push-fix-log.txt');
const log = [];

function run(cmd) {
  log.push(`> ${cmd}`);
  try {
    const out = execSync(cmd, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    if (out.trim()) log.push(out.trim());
    return true;
  } catch (error) {
    log.push(error.stdout?.toString() || '');
    log.push(error.stderr?.toString() || error.message);
    return false;
  }
}

function patchPageJs(source) {
  let code = source;

  if (!code.includes('const getSupplierImage')) {
    code = code.replace(
      '  const mapCategoryToFiesta = (cat) => {',
      `  const getSupplierImage = (supplier) => {
    if (!supplier) return null;
    if (supplier.images?.length) {
      const img = supplier.images.find((item) => item && item.startsWith('http'));
      if (img) return img;
      return supplier.images[0];
    }
    if (supplier['Google Image'] && supplier['Google Image'] !== 'nan') return supplier['Google Image'];
    if (supplier['Main Image'] && supplier['Main Image'] !== 'nan') return supplier['Main Image'];
    return null;
  };

  const mapCategoryToFiesta = (cat) => {`
    );
  }

  code = code.replace(
    /setFiestaPushLoading\(true\);\s*setFiestaPushResult\(null\);\s*setFiestaPushError\(''\);/,
    `if (!fiestaPushForm.type) {
      setFiestaPushError('יש לבחור קטגוריה לפני השליחה');
      setFiestaPushStep(2);
      return;
    }

    setFiestaPushLoading(true);
    setFiestaPushResult(null);
    setFiestaPushError('');`
  );

  code = code.replace(
    'agentName: activeAgent\n          }',
    `agentName: activeAgent,
            images: fiestaPushForm.selectedImages || fiestaPushForm.images || fiestaPushSupplier?.images || [],
            reviews: fiestaPushForm.reviews || fiestaPushSupplier?.reviews || []
          }`
  );

  if (!code.includes('if (!res.ok)')) {
    code = code.replace(
      'const data = await res.json();',
      `const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFiestaPushResult('error');
        setFiestaPushError(data.error || \`שגיאת שרת (\${res.status})\`);
        return;
      }`
    );
  }

  code = code.replace(
    /\(s\["Google Image"\] \|\| s\["Main Image"\]\)/g,
    'getSupplierImage(s)'
  );

  code = code.replace(
    /src=\{s\["Google Image"\] \|\| s\["Main Image"\]\}/g,
    'src={getSupplierImage(s)}'
  );

  code = code.replace(
    /\(selectedSupplierProfile\["Google Image"\] \|\| selectedSupplierProfile\["Main Image"\]\)/g,
    'getSupplierImage(selectedSupplierProfile)'
  );

  code = code.replace(
    'zIndex: 4000, padding: \'20px\'',
    'zIndex: 11000, padding: \'20px\''
  );

  return code;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  return res.text();
}

try {
  log.push('Downloading latest page.js from GitHub...');
  const remotePage = await download(
    'https://raw.githubusercontent.com/nati325/fiesta_sapakim/main/app/page.js'
  );
  const patchedPage = patchPageJs(remotePage);
  fs.writeFileSync(path.join(root, 'app', 'page.js'), patchedPage, 'utf8');
  log.push('Updated app/page.js from remote + patches');

  run('git add -A');
  run('git commit -m "Merge remote dashboard with supplier/image fixes"');
  run('git fetch origin');
  if (!run('git rebase origin/main')) {
    log.push('Rebase failed, trying merge...');
    run('git rebase --abort');
    run('git merge origin/main -m "Merge origin/main with local fixes"');
  }
  run('git push origin main');

  log.push('Finished.');
} catch (error) {
  log.push(`Fatal: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(logFile, log.join('\n'), 'utf8');
  console.log(log.join('\n'));
}
