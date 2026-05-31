import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function keepHead(content) {
  return content.replace(/<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n[\s\S]*?>>>>>>> origin\/main\r?\n/g, '$1');
}

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
}

const jsonFiles = [
  'data/suppliers_complete.json',
  'data/supplier_descriptions.json',
];

for (const rel of jsonFiles) {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) continue;
  const fixed = keepHead(fs.readFileSync(filePath, 'utf8'));
  fs.writeFileSync(filePath, fixed, 'utf8');
  console.log(`Resolved JSON conflicts in ${rel}`);
}

console.log('Done resolving JSON. Now stage and commit merge.');
