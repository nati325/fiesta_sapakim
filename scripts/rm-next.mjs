import fs from 'fs';

if (fs.existsSync('.next')) {
  fs.rmSync('.next', { recursive: true, force: true });
  console.log('[dev:fresh] Removed .next cache');
}
