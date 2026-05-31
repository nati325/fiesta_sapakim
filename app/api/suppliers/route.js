import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../../../lib/supplierEnrichment';
import { supplierMatchesSearch } from '../../../lib/searchUtils';

export const dynamic = 'force-dynamic';

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
    const suppliers = list
      .map((item) => normalizeSupplierRecord(item))
      .filter((s) => {
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

    console.log(`GET /api/suppliers: returning ${suppliers.length} suppliers (json source)`);
    return NextResponse.json(suppliers, {
      headers: { 'X-Suppliers-Source': 'json', 'X-Suppliers-Count': String(suppliers.length) },
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
    if (description !== undefined) updateFields.description = description;
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
