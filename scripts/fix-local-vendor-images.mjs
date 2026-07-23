import { MongoClient } from 'mongodb';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureCloudUrl } from '../lib/cloudinaryUpload.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv(path.join(__dirname, '..', '.env.local'));

const uri = process.env.FIESTA_MONGODB_URI;
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 25000 });
await client.connect();
const vendors = client.db('fiesta').collection('vendors');

const broken = await vendors
  .find({
    $or: [
      { image: { $regex: '^/' } },
      { 'portfolio.image': { $regex: '^/' } },
    ],
  })
  .toArray();

console.log('Vendors with local image paths:', broken.length);

for (const v of broken) {
  let image = v.image;
  if (String(image || '').startsWith('/')) {
    // try resolve via Fiesta public folder copy path as /media equivalent won't work
    // Upload from fiesta public if exists
    const localFiesta = path.join(
      __dirname,
      '..',
      '..',
      'Fiesta',
      'fiesta-nextjs',
      'public',
      String(image).replace(/^\//, '')
    );
    if (fs.existsSync(localFiesta)) {
      const { v2: cloudinary } = await import('cloudinary');
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const up = await cloudinary.uploader.upload(localFiesta, {
        folder: 'fiesta-vendors',
        public_id: `vendor-${String(v._id)}-main`,
        overwrite: true,
      });
      image = up.secure_url;
      console.log('Uploaded main for', v.name, '→', image);
    } else {
      console.warn('Missing local file for', v.name, image);
    }
  }

  const portfolio = [];
  for (let i = 0; i < (v.portfolio || []).length; i++) {
    const item = v.portfolio[i];
    let img = item.image || item;
    if (String(img).startsWith('/')) {
      const localFiesta = path.join(
        __dirname,
        '..',
        '..',
        'Fiesta',
        'fiesta-nextjs',
        'public',
        String(img).replace(/^\//, '')
      );
      if (fs.existsSync(localFiesta)) {
        const { v2: cloudinary } = await import('cloudinary');
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });
        const up = await cloudinary.uploader.upload(localFiesta, {
          folder: 'fiesta-vendors',
          public_id: `vendor-${String(v._id)}-p${i}`,
          overwrite: true,
        });
        img = up.secure_url;
      }
    }
    portfolio.push(typeof item === 'object' ? { ...item, image: img } : { title: `תמונה ${i + 1}`, image: img });
  }

  await vendors.updateOne(
    { _id: v._id },
    { $set: { image, portfolio, updatedAt: new Date() } }
  );
  console.log('Fixed', v.name);
}

await client.close();
