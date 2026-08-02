import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../../../lib/supplierEnrichment';
import { cleanDescription } from '../../../lib/cleanDescription';
import { supplierMatchesSearch } from '../../../lib/searchUtils';
import { phoneKey } from '../../../lib/phoneUtils';
import {
  countSuppliersInMongo,
  findSupplierByPhone,
  findSuppliers,
  jsonItemToMongoDoc,
  bulkUpsertSuppliers,
  updateSupplierFields,
} from '../../../lib/suppliersMongo';

export const dynamic = 'force-dynamic';

function filterValidSuppliers(list) {
  return list.filter((s) => {
    const name = (s['Supplier Name'] || s.clean_name || '').trim();
    const phone = s['Real Phone'] || s['Phone Number'] || '';
    return name && name !== 'ספק ללא שם' && phone && phone !== 'FAILED' && phone !== 'N/A';
  });
}

function toLiteSupplier(s) {
  const images = (s.images || []).filter(Boolean);
  const main = s['Main Image'] || images[0] || '';
  return {
    id: s.id ?? null,
    clean_name: s.clean_name,
    'Supplier Name': s['Supplier Name'],
    name: s['Supplier Name'] || s.name,
    'Real Phone': s['Real Phone'],
    phone: s['Real Phone'] || s.phone,
    'Phone Number': s['Phone Number'] || '',
    Category: s.Category || s.category || '',
    category: s.Category || s.category || '',
    Address: s.Address || s.address || '',
    Website: s.Website || s.website || '',
    URL: s.URL || s.engaged_url || '',
    engaged_url: s.engaged_url || s.URL || '',
    'Main Image': main,
    images: main ? [main] : [],
    description: '',
    reviews: [],
    reviews_count: s['Reviews Count'] || s.reviews_count || null,
    google_rating: s['Google Rating'] || s.google_rating || null,
    lite: true,
  };
}

async function loadFromJsonFallback({ lite, phoneQuery, search }) {
  const { list } = loadSuppliersFromJson();
  let suppliers = filterValidSuppliers(list.map((item) => normalizeSupplierRecord(item)));

  if (phoneQuery) {
    const key = phoneKey(phoneQuery);
    const match = suppliers.find((s) => phoneKey(s['Real Phone'] || s.phone) === key);
    return { suppliers: match ? [match] : [], source: 'json' };
  }

  if (search) {
    const q = search.trim();
    suppliers = suppliers.filter((s, i) => supplierMatchesSearch(s, q, i + 1));
  }

  return {
    suppliers: lite ? suppliers.map(toLiteSupplier) : suppliers,
    source: 'json',
  };
}

async function loadFromMongo({ lite, phoneQuery, search, category }) {
  const mongoCount = await countSuppliersInMongo();
  if (mongoCount === 0) return null;

  if (phoneQuery) {
    const match = await findSupplierByPhone(phoneQuery, { lite: false });
    return { suppliers: match ? [match] : [], source: 'mongodb', total: mongoCount };
  }

  const suppliers = await findSuppliers({
    lite,
    search: search || '',
    category: category || '',
  });

  return { suppliers, source: 'mongodb', total: mongoCount };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get('verify') === '1') {
      let total = 0;
      let source = 'json';
      try {
        total = await countSuppliersInMongo();
        if (total > 0) source = 'mongodb';
      } catch {
        total = loadSuppliersFromJson().list.length;
      }
      if (total === 0) total = loadSuppliersFromJson().list.length;

      return NextResponse.json({ ok: true, totalSuppliers: total, source });
    }

    const lite = searchParams.get('lite') === '1';
    const phoneQuery = searchParams.get('phone') || '';
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';

    let result = null;
    try {
      result = await loadFromMongo({ lite, phoneQuery, search, category });
    } catch (mongoErr) {
      console.error('MongoDB suppliers read failed, falling back to JSON:', mongoErr.message);
    }

    if (!result) {
      result = await loadFromJsonFallback({ lite, phoneQuery, search });
    }

    const { suppliers, source, total } = result;

    if (phoneQuery && !suppliers.length) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    }

    console.log(
      `GET /api/suppliers: ${suppliers.length} rows (${lite ? 'lite' : 'full'} source=${source}${search ? ` search="${search}"` : ''})`
    );

    return NextResponse.json(suppliers, {
      headers: {
        'X-Suppliers-Source': source,
        'X-Suppliers-Count': String(total ?? suppliers.length),
        'X-Suppliers-Returned': String(suppliers.length),
        'X-Suppliers-Mode': lite ? 'lite' : 'full',
      },
    });
  } catch (error) {
    console.error('API Error during GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { phone, name, images, description, reviews } = await req.json();

    if (!phone) {
      return NextResponse.json({ error: 'Missing supplier phone' }, { status: 400 });
    }

    const updateFields = {};
    if (images !== undefined) updateFields.images = images;
    if (description !== undefined) updateFields.description = cleanDescription(description);
    if (reviews !== undefined) updateFields.reviews = reviews;

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    let savedTo = 'json';

    try {
      const mongoCount = await countSuppliersInMongo();
      if (mongoCount > 0) {
        const ok = await updateSupplierFields(phone, updateFields);
        if (ok) savedTo = 'mongodb';
      }
    } catch (mongoErr) {
      console.error('MongoDB supplier update failed:', mongoErr.message);
    }

    const jsonPath = path.join(process.cwd(), 'data', 'suppliers_complete.json');
    if (fs.existsSync(jsonPath)) {
      try {
        let content = fs.readFileSync(jsonPath, 'utf-8');
        if (content.includes('<<<<<<<')) {
          content = content.replace(
            /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n[\s\S]*?>>>>>>> origin\/main\r?\n/g,
            '$1'
          );
        }
        const rawData = JSON.parse(content);

        const updatedData = rawData.map((item) => {
          const itemPhone = phoneKey(item.real_phone || item.phone);
          const searchPhone = phoneKey(phone);
          if (itemPhone && searchPhone && itemPhone === searchPhone) {
            return { ...item, ...updateFields };
          }
          return item;
        });

        fs.writeFileSync(jsonPath, JSON.stringify(updatedData, null, 2), 'utf-8');
      } catch (jsonError) {
        console.error('Failed to update JSON fallback:', jsonError.message);
      }
    }

    if (description !== undefined && name) {
      const descPath = path.join(process.cwd(), 'data', 'supplier_descriptions.json');
      if (fs.existsSync(descPath)) {
        try {
          const descData = JSON.parse(fs.readFileSync(descPath, 'utf-8'));
          descData[name] = {
            description,
            source: 'agent_edited',
            last_updated: new Date().toISOString().replace('T', ' ').substring(0, 19),
          };
          fs.writeFileSync(descPath, JSON.stringify(descData, null, 2), 'utf-8');
        } catch (descError) {
          console.error('Failed to update supplier_descriptions.json:', descError.message);
        }
      }
    }

    if (reviews !== undefined && name) {
      const reviewsPath = path.join(process.cwd(), 'data', 'supplier_reviews.json');
      if (fs.existsSync(reviewsPath)) {
        try {
          const reviewsData = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
          reviewsData[name] = reviews;
          fs.writeFileSync(reviewsPath, JSON.stringify(reviewsData, null, 2), 'utf-8');
        } catch (reviewsError) {
          console.error('Failed to update supplier_reviews.json:', reviewsError.message);
        }
      }
    }

    return NextResponse.json({ success: true, savedTo });
  } catch (error) {
    console.error('API Error during POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** One-time sync endpoint for admin — POST with { sync: true } could be added later */
export async function PUT() {
  try {
    const jsonPath = path.join(process.cwd(), 'data', 'suppliers_complete.json');
    if (!fs.existsSync(jsonPath)) {
      return NextResponse.json({ error: 'suppliers_complete.json not found' }, { status: 404 });
    }

    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const docs = raw.map(jsonItemToMongoDoc).filter(Boolean);
    const result = await bulkUpsertSuppliers(docs);
    const total = await countSuppliersInMongo();

    return NextResponse.json({ success: true, ...result, total });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
