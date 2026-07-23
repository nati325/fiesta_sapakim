/**
 * One-off: fix Hoshen vendor that was pushed with wrong type + generic description.
 * Run from Fiesta/fiesta-nextjs (needs mongodb) or fiesta_sapakim.
 */
import { MongoClient } from 'mongodb';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv(path.join(__dirname, '..', '.env.local'));
loadEnv(path.join(__dirname, '..', '..', 'Fiesta', 'fiesta-nextjs', '.env'));

const {
  mapCategoryToFiesta,
  buildDefaultDescription,
} = await import('../lib/fiestaCategoryMap.js');
const { prepareAgreementImage, pickMainImage, toPortfolioItems } = await import('../lib/fiestaImages.js');

const FIESTA_URI =
  process.env.FIESTA_MONGODB_URI ||
  process.env.MONGODB_URI ||
  'mongodb+srv://netaneldama_db_user:Dama3253%21%3F@cluster0.zptzjg6.mongodb.net/fiesta?retryWrites=true&w=majority&appName=Cluster0';

const suppliersPath = path.join(__dirname, '..', 'data', 'suppliers_complete.json');
const suppliers = JSON.parse(fs.readFileSync(suppliersPath, 'utf8'));
const hoshenRaw = suppliers.find(
  (s) =>
    String(s.real_phone || s.phone || '').includes('3987041') ||
    /חושן|HOSHEN/i.test(s.name || '')
);

if (!hoshenRaw) {
  console.error('Hoshen not found in suppliers_complete.json');
  process.exit(1);
}

const supplier = {
  'Supplier Name': hoshenRaw.name,
  name: hoshenRaw.name,
  Category: hoshenRaw.category,
  category: hoshenRaw.category,
  description: hoshenRaw.description,
  Address: hoshenRaw.address,
  address: hoshenRaw.address,
  Website: hoshenRaw.website,
  'Real Phone': hoshenRaw.real_phone || hoshenRaw.phone,
  phone: hoshenRaw.real_phone || hoshenRaw.phone,
  images: hoshenRaw.images || [],
  portfolio: hoshenRaw.portfolio || [],
  reviews: hoshenRaw.reviews || [],
  'Google Rating': hoshenRaw.google_rating,
  'Reviews Count': hoshenRaw.reviews_count,
};

const type = mapCategoryToFiesta(supplier.Category, supplier);
const description = buildDefaultDescription(supplier);
const selectedImages = supplier.images || [];

console.log('Mapped type:', type);
console.log('Description preview:', description.slice(0, 120));
console.log('Images:', selectedImages.length);

const client = new MongoClient(FIESTA_URI, { serverSelectionTimeoutMS: 25000 });
await client.connect();
const vendors = client.db('fiesta').collection('vendors');

const existing = await vendors.findOne({
  $or: [
    { contact: { $regex: '054[^0-9]*3987041' } },
    { name: { $regex: /חושן|HOSHEN/i } },
  ],
});

if (!existing) {
  console.error('Hoshen vendor not found in Fiesta DB');
  await client.close();
  process.exit(1);
}

const origin = process.env.SCRAPING_PUBLIC_URL || '';
const mainImage = await pickMainImage(supplier, origin, selectedImages);
const portfolio = await toPortfolioItems(selectedImages, origin);

let agreementImage = existing.agreementImage || '';
if (String(agreementImage).startsWith('data:image/')) {
  const uploaded = await prepareAgreementImage(agreementImage, origin);
  if (uploaded) agreementImage = uploaded;
}

const $set = {
  type,
  description,
  image: mainImage || existing.image,
  portfolio: portfolio.length ? portfolio : existing.portfolio,
  agreementImage,
  adminNotes: [
    existing.adminNotes || '',
    `🔧 תוקן אוטומטית: type→${type}, description מהסקרייפינג, ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n'),
  updatedAt: new Date(),
};

await vendors.updateOne({ _id: existing._id }, { $set });
const after = await vendors.findOne({ _id: existing._id });
console.log(
  JSON.stringify(
    {
      ok: true,
      name: after.name,
      type: after.type,
      description: String(after.description || '').slice(0, 160),
      image: String(after.image || '').slice(0, 100),
      portfolioCount: (after.portfolio || []).length,
      agreementIsDataUri: String(after.agreementImage || '').startsWith('data:'),
      agreementPrefix: String(after.agreementImage || '').slice(0, 60),
    },
    null,
    2
  )
);

await client.close();
