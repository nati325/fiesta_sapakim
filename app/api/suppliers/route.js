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
    const destSuppliersMedia = path.join(process.cwd(), 'public', 'media', 'suppliers');
    const destPortfoliosMedia = path.join(process.cwd(), 'public', 'media', 'portfolios');
    const srcData = path.join(process.cwd(), 'data');
    const srcSuppliersMedia = path.join(process.cwd(), 'public', 'media', 'suppliers');
    const srcPortfoliosMedia = path.join(process.cwd(), 'public', 'media', 'portfolios');

    if (fs.existsSync(srcData)) {
      if (!fs.existsSync(destData)) {
        fs.mkdirSync(destData, { recursive: true });
      }
    }

    if (!fs.existsSync(destSuppliersMedia) && fs.existsSync(srcSuppliersMedia)) {
      fs.mkdirSync(path.dirname(destSuppliersMedia), { recursive: true });
    }
    if (!fs.existsSync(destPortfoliosMedia) && fs.existsSync(srcPortfoliosMedia)) {
      fs.mkdirSync(path.dirname(destPortfoliosMedia), { recursive: true });
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
