import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { copyLocalImageToFiestaPublic, toPortfolioItems } from '../lib/fiestaImages.js';
import { loadSuppliersFromJson } from '../lib/supplierEnrichment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function pickWorkingImage(currentImage, enriched) {
  const copied = copyLocalImageToFiestaPublic(currentImage || '');
  if (copied.startsWith('/images/vendors/')) return copied;

  const candidates = [
    currentImage,
    enriched?.['Main Image'],
    enriched?.['Google Image'],
    ...(enriched?.images || []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      return candidate;
    }
    const local = copyLocalImageToFiestaPublic(candidate);
    if (local.startsWith('/images/vendors/')) return local;
  }

  return currentImage || '';
}

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

async function main() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) {
    console.error('Missing FIESTA_MONGODB_URI in .env.local');
    process.exit(1);
  }

  process.chdir(projectRoot);
  const enrichmentMaps = loadSuppliersFromJson(projectRoot);

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });

  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');
  const all = await vendors.find({}).toArray();

  let updated = 0;
  for (const vendor of all) {
    const enriched = enrichmentMaps.byName[vendor.name];
    const nextImage = pickWorkingImage(vendor.image, enriched);

    const rawPortfolio = Array.isArray(vendor.portfolio) ? vendor.portfolio : [];
    const imageUrls = rawPortfolio
      .map((item) => (typeof item === 'string' ? item : item?.image))
      .filter(Boolean);

    const fallbackImages = enriched?.images?.length ? enriched.images : imageUrls;
    const nextPortfolio = toPortfolioItems(fallbackImages, '');

    const needsImageFix = nextImage && nextImage !== vendor.image;
    const needsPortfolioFix =
      nextPortfolio.length > 0 &&
      JSON.stringify(nextPortfolio) !== JSON.stringify(rawPortfolio);

    if (!needsImageFix && !needsPortfolioFix) continue;

    await vendors.updateOne(
      { _id: vendor._id },
      {
        $set: {
          ...(needsImageFix ? { image: nextImage } : {}),
          ...(needsPortfolioFix ? { portfolio: nextPortfolio } : {}),
        },
      }
    );
    updated += 1;
    console.log(`Fixed: ${vendor.name}`);
  }

  await client.close();
  console.log(`Done. Updated ${updated} vendors.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
