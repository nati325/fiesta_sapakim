import getMongoClient from './mongodb.js';
import { phoneKey, formatPhoneDisplay } from './phoneUtils.js';
import { cleanDescription } from './cleanDescription.js';
import { normalizeReviewsList } from './supplierEnrichment.js';

const DB_NAME = 'fiesta_crm';
const COLLECTION = 'suppliers';

function cleanValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str || str === 'nan' || str === 'N/A' || str === 'FAILED') return '';
  return str;
}

export function jsonItemToMongoDoc(item) {
  const name = cleanValue(item.name || item['Supplier Name']) || cleanValue(item.clean_name) || '';
  const realPhoneRaw = item.real_phone || item['Real Phone'] || item.phone || item['Phone Number'] || '';
  const key = phoneKey(realPhoneRaw);
  if (!key || !name || name === 'ספק ללא שם') return null;

  const realPhone = formatPhoneDisplay(realPhoneRaw) || realPhoneRaw;
  const category = cleanValue(item.category || item.Category) || '';
  const images = (item.images || []).filter(Boolean);
  const reviews = normalizeReviewsList(item.reviews);

  return {
    phoneKey: key,
    id: item.id ?? null,
    name,
    clean_name: cleanValue(item.clean_name) || name.split('|')[0]?.trim() || name,
    real_phone: realPhone,
    phone: realPhone,
    category,
    address: cleanValue(item.address || item.Address) || null,
    website: cleanValue(item.website || item.Website) || null,
    engaged_url: cleanValue(item.engaged_url || item.URL) || null,
    easy_url_internal: item.easy_url_internal || null,
    images,
    reviews,
    description: cleanDescription(item.description || ''),
    google_rating: cleanValue(item.google_rating || item['Google Rating']) || null,
    reviews_count: cleanValue(item.reviews_count || item['Reviews Count']) || null,
    portfolio: item.portfolio || [],
    instagram: item.instagram || null,
    facebook: item.facebook || null,
    source_import: item.source_import || null,
    searchText: [name, item.clean_name, category, realPhone, key, item.id != null ? String(item.id) : '']
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    updatedAt: new Date(),
  };
}

export function mongoDocToSupplier(doc, { lite = false } = {}) {
  if (!doc) return null;

  const images = (doc.images || []).filter(Boolean);
  const main = images[0] || '';

  const base = {
    id: doc.id ?? null,
    clean_name: doc.clean_name || doc.name?.split('|')[0]?.trim() || doc.name,
    'Supplier Name': doc.name,
    name: doc.name,
    'Real Phone': doc.real_phone || doc.phone,
    phone: doc.real_phone || doc.phone,
    'Phone Number': doc.phone || doc.real_phone || '',
    Category: doc.category || '',
    category: doc.category || '',
    Address: doc.address || '',
    Website: doc.website || '',
    URL: doc.engaged_url || '',
    engaged_url: doc.engaged_url || '',
    'Main Image': main,
    'Google Rating': doc.google_rating || '',
    'Reviews Count': doc.reviews_count || '',
    google_rating: doc.google_rating,
    reviews_count: doc.reviews_count,
  };

  if (lite) {
    return {
      ...base,
      images: main ? [main] : [],
      description: '',
      reviews: [],
      lite: true,
    };
  }

  return {
    ...base,
    images,
    description: doc.description || '',
    reviews: normalizeReviewsList(doc.reviews),
    portfolio: doc.portfolio || [],
    instagram: doc.instagram,
    facebook: doc.facebook,
    source_import: doc.source_import,
    lite: false,
  };
}

export async function getSuppliersCollection() {
  const client = await getMongoClient();
  return client.db(DB_NAME).collection(COLLECTION);
}

export async function ensureSupplierIndexes(collection = null) {
  const col = collection || (await getSuppliersCollection());
  await col.deleteMany({ $or: [{ phoneKey: null }, { phoneKey: '' }, { phoneKey: { $exists: false } }] });
  await col.createIndex({ phoneKey: 1 }, { unique: true, sparse: true });
  await col.createIndex({ category: 1 });
  await col.createIndex({ id: 1 });
  await col.createIndex({ name: 1 });
  await col.createIndex({ searchText: 1 });
}

export async function countSuppliersInMongo() {
  const col = await getSuppliersCollection();
  return col.countDocuments({});
}

export async function bulkUpsertSuppliers(docs) {
  const col = await getSuppliersCollection();
  await ensureSupplierIndexes(col);

  const valid = docs.filter(Boolean);
  if (!valid.length) return { upserted: 0, modified: 0 };

  const ops = valid.map((doc) => ({
    updateOne: {
      filter: { phoneKey: doc.phoneKey },
      update: { $set: doc },
      upsert: true,
    },
  }));

  const batchSize = 500;
  let upserted = 0;
  let modified = 0;

  for (let i = 0; i < ops.length; i += batchSize) {
    const batch = ops.slice(i, i + batchSize);
    const result = await col.bulkWrite(batch, { ordered: false });
    upserted += result.upsertedCount || 0;
    modified += result.modifiedCount || 0;
  }

  return { upserted, modified, total: valid.length };
}

function buildSearchFilter(search) {
  const q = String(search || '').trim();
  if (!q) return null;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const digits = q.replace(/\D/g, '');
  const or = [{ searchText: { $regex: escaped, $options: 'i' } }];
  if (digits.length >= 3) {
    or.push({ phoneKey: { $regex: digits } });
  }
  return { $or: or };
}

export async function findSuppliers({
  lite = false,
  phone = '',
  search = '',
  category = '',
  limit = 0,
  skip = 0,
} = {}) {
  const col = await getSuppliersCollection();
  const filter = {};

  if (phone) {
    filter.phoneKey = phoneKey(phone);
  }

  if (category) {
    filter.category = category;
  }

  if (search) {
    const searchFilter = buildSearchFilter(search);
    if (searchFilter) Object.assign(filter, searchFilter);
  }

  const projection = lite
    ? {
        phoneKey: 1,
        id: 1,
        name: 1,
        clean_name: 1,
        real_phone: 1,
        phone: 1,
        category: 1,
        address: 1,
        website: 1,
        engaged_url: 1,
        images: { $slice: 1 },
        google_rating: 1,
        reviews_count: 1,
      }
    : {};

  let cursor = col.find(filter, projection).sort({ id: 1, name: 1 });
  if (skip) cursor = cursor.skip(skip);
  if (limit) cursor = cursor.limit(limit);

  const docs = await cursor.toArray();
  return docs.map((doc) => mongoDocToSupplier(doc, { lite }));
}

export async function updateSupplierFields(phone, fields = {}) {
  const key = phoneKey(phone);
  if (!key) throw new Error('Invalid phone');

  const col = await getSuppliersCollection();
  const set = { updatedAt: new Date() };

  if (fields.images !== undefined) set.images = fields.images;
  if (fields.description !== undefined) set.description = cleanDescription(fields.description);
  if (fields.reviews !== undefined) set.reviews = normalizeReviewsList(fields.reviews);

  const result = await col.updateOne({ phoneKey: key }, { $set: set });
  return result.matchedCount > 0;
}

export async function findSupplierByPhone(phone, { lite = false } = {}) {
  const results = await findSuppliers({ phone, lite, limit: 1 });
  return results[0] || null;
}
