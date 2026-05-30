import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import getMongoClient from '../../../lib/mongodb';
import { enrichSupplierRecord, loadSuppliersFromJson } from '../../../lib/supplierEnrichment';

export const dynamic = 'force-dynamic';

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function ensureResourcesLinked() {
  try {
    const destData = path.join(process.cwd(), 'data');
    if (!fs.existsSync(destData)) {
      fs.mkdirSync(destData, { recursive: true });
    }
  } catch (e) {
    console.error('Error setting up resource links:', e.message);
  }
}

export async function GET() {
  try {
    ensureResourcesLinked();
    const enrichmentMaps = loadSuppliersFromJson();

    if (enrichmentMaps.list.length > 0) {
      console.log(`GET /api/suppliers: Using enriched JSON (${enrichmentMaps.list.length} suppliers)`);
      return NextResponse.json(enrichmentMaps.list);
    }

    console.log('GET /api/suppliers: Fetching from MongoDB...');
    try {
      const client = await getMongoClient();
      const db = client.db('fiesta_crm');
      const collection = db.collection('suppliers');
      const dbSuppliers = await collection.find({}).toArray();
      console.log(`Fetched ${dbSuppliers.length} suppliers from MongoDB.`);

      if (dbSuppliers.length > 0) {
        const data = dbSuppliers.map((item) =>
          enrichSupplierRecord(
            {
              'Supplier Name': item.name || '',
              'Phone Number': item.phone || '',
              Category: item.category || '',
              URL: item.engaged_url || '',
              'Main Image': item.main_image || '',
              Gallery: item.gallery || '',
              'Real Phone': item.real_phone || '',
              Website: item.website || '',
              'Google Rating': item.google_rating || '',
              'Reviews Count': item.reviews_count || '',
              Address: item.address || '',
              description: item.description || '',
              reviews: item.reviews || [],
              images: item.images || [],
            },
            enrichmentMaps
          )
        );
        return NextResponse.json(data);
      }
    } catch (dbError) {
      console.error('MongoDB fetch failed, falling back to local files:', dbError.message);
    }

    const csvPath = path.join(process.cwd(), 'scraping', 'engaged_suppliers_final_production.csv');
    if (!fs.existsSync(csvPath)) {
      return NextResponse.json([]);
    }

    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = fileContent.split('\n').filter((line) => line.trim());
    const headers = parseCSVLine(lines[0]);

    const data = lines
      .slice(1)
      .map((line) => {
        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = values[i] || '';
        });
        return enrichSupplierRecord(obj, enrichmentMaps);
      })
      .filter((item) => {
        const phone = item['Real Phone'] || item['Phone Number'];
        return phone && phone !== 'FAILED' && phone !== 'N/A' && phone !== '';
      });

    return NextResponse.json(data);
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

    try {
      const client = await getMongoClient();
      const db = client.db('fiesta_crm');
      const collection = db.collection('suppliers');

      await collection.updateOne({ phone }, { $set: updateFields });
      console.log(`Updated supplier ${phone} fields in MongoDB:`, Object.keys(updateFields));
    } catch (dbError) {
      console.error('MongoDB update failed:', dbError.message);
    }

    const jsonPath = path.join(process.cwd(), 'data', 'suppliers_complete.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        let updated = false;

        const updatedData = rawData.map((item) => {
          const itemPhone = item.real_phone || item.phone || '';
          if (itemPhone === phone) {
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
