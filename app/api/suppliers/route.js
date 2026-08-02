import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../../../lib/supplierEnrichment';
import { cleanDescription } from '../../../lib/cleanDescription';
import { supplierMatchesSearch } from '../../../lib/searchUtils';
import { phoneKey } from '../../../lib/phoneUtils';

export const dynamic = 'force-dynamic';

function filterValidSuppliers(list) {
  return list.filter((s) => {
    const name = (s['Supplier Name'] || s.clean_name || '').trim();
    const phone = s['Real Phone'] || s['Phone Number'] || '';
    return (
      name &&
      name !== 'ספק ללא שם' &&
      phone &&
      phone !== 'FAILED' &&
      phone !== 'N/A'
    );
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

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('verify') === '1') {
      const { list } = loadSuppliersFromJson();
      const lior = list.find((s) => (s['Supplier Name'] || '').includes('ליאור פרץ'));
      const liorIndex = lior ? list.indexOf(lior) + 1 : null;
      return NextResponse.json({
        ok: true,
        totalSuppliers: list.length,
        lior: lior
          ? { found: true, name: lior['Supplier Name'], phone: lior['Real Phone'], index: liorIndex }
          : { found: false },
        searchLiorTypo: lior
          ? supplierMatchesSearch(lior, 'ליאר פרץ', liorIndex)
          : false,
      });
    }

    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const { list } = loadSuppliersFromJson();
    const suppliers = filterValidSuppliers(list.map((item) => normalizeSupplierRecord(item)));

    const lite = searchParams.get('lite') === '1';
    const phoneQuery = searchParams.get('phone');

    if (phoneQuery) {
      const key = phoneKey(phoneQuery);
      const match = suppliers.find((s) => phoneKey(s['Real Phone'] || s.phone) === key);
      if (!match) {
        return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
      }
      return NextResponse.json(match);
    }

    const payload = lite ? suppliers.map(toLiteSupplier) : suppliers;

    console.log(
      `GET /api/suppliers: returning ${payload.length} suppliers (${lite ? 'lite' : 'full'} source=json)`
    );
    return NextResponse.json(payload, {
      headers: {
        'X-Suppliers-Source': 'json',
        'X-Suppliers-Count': String(payload.length),
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
        let updated = false;

        const updatedData = rawData.map((item) => {
          const itemPhone = (item.real_phone || item.phone || '').replace(/\D/g, '');
          const searchPhone = String(phone).replace(/\D/g, '');
          if (itemPhone && searchPhone && itemPhone === searchPhone) {
            updated = true;
            return { ...item, ...updateFields };
          }
          return item;
        });

        if (updated) {
          fs.writeFileSync(jsonPath, JSON.stringify(updatedData, null, 2), 'utf-8');
        }
      } catch (jsonError) {
        console.error('Failed to update local JSON fallback:', jsonError.message);
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API Error during POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
