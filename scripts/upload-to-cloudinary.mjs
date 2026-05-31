/**
 * upload-to-cloudinary.mjs
 * Scans all vendors in Fiesta MongoDB and uploads any local /media/... images to Cloudinary.
 * Replaces local paths with permanent Cloudinary URLs in the database.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// Load .env.local
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(path.join(projectRoot, '.env.local'));
loadEnv(path.join(projectRoot, '.env'));

const { v2: cloudinary } = await import('cloudinary');
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.error('❌ CLOUDINARY_CLOUD_NAME missing from .env.local');
  process.exit(1);
}

async function uploadFile(localRelativePath) {
  if (!localRelativePath || !localRelativePath.startsWith('/media/')) return null;

  const localFilePath = path.join(projectRoot, 'public', localRelativePath.replace(/^\//, ''));
  if (!fs.existsSync(localFilePath)) {
    console.log(`    ⚠️  File not found locally: ${localFilePath}`);
    return null;
  }

  const parts = localRelativePath.split('/').filter(Boolean);
  const folder = parts[parts.length - 2] || 'suppliers';
  const fileName = path.basename(localRelativePath, path.extname(localRelativePath));
  const publicId = `fiesta-suppliers/${folder}/${fileName}`;

  try {
    const result = await cloudinary.uploader.upload(localFilePath, {
      public_id: publicId,
      overwrite: false,
      resource_type: 'image',
    });
    return result.secure_url;
  } catch (err) {
    console.log(`    ❌ Cloudinary error: ${err.message}`);
    return null;
  }
}

async function processVendor(vendors, vendor) {
  const updates = {};
  let changed = false;

  // Check main image
  if (vendor.image && vendor.image.startsWith('/media/')) {
    console.log(`  📸 Uploading main image: ${vendor.image}`);
    const url = await uploadFile(vendor.image);
    if (url) {
      updates.image = url;
      changed = true;
      console.log(`    ✅ → ${url}`);
    }
  }

  // Check portfolio images
  if (vendor.portfolio && vendor.portfolio.length > 0) {
    const newPortfolio = [...vendor.portfolio];
    for (let i = 0; i < newPortfolio.length; i++) {
      const item = newPortfolio[i];
      if (item?.image && item.image.startsWith('/media/')) {
        console.log(`  📸 Uploading portfolio[${i}]: ${item.image}`);
        const url = await uploadFile(item.image);
        if (url) {
          newPortfolio[i] = { ...item, image: url };
          changed = true;
          console.log(`    ✅ → ${url}`);
        }
      }
    }
    if (changed) updates.portfolio = newPortfolio;
  }

  if (changed) {
    await vendors.updateOne({ _id: vendor._id }, { $set: updates });
    console.log(`  💾 Saved to MongoDB`);
  } else {
    console.log(`  ✓ No local images to upload`);
  }
}

async function main() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) { console.error('❌ FIESTA_MONGODB_URI missing'); process.exit(1); }

  console.log('Connecting to MongoDB...');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  const allVendors = await vendors.find({}).toArray();
  console.log(`\nFound ${allVendors.length} vendors. Checking for local images...\n`);

  let uploadCount = 0;
  for (const vendor of allVendors) {
    const hasLocal =
      vendor.image?.startsWith('/media/') ||
      vendor.portfolio?.some(p => p?.image?.startsWith('/media/'));

    if (!hasLocal) continue;

    console.log(`\n[${vendor.type}] ${vendor.name}`);
    await processVendor(vendors, vendor);
    uploadCount++;
  }

  if (uploadCount === 0) {
    console.log('✅ No local images found — all vendors already have cloud URLs!');
  } else {
    console.log(`\n✅ Done! Processed ${uploadCount} vendor(s) with local images.`);
  }

  await client.close();
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
