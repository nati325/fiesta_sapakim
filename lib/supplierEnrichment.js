import fs from 'fs';
import path from 'path';

function cleanValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str || str === 'nan' || str === 'N/A' || str === 'FAILED') return '';
  return str;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

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

function loadCsvByName(cwd) {
  const csvPath = path.join(cwd, 'scraping', 'engaged_suppliers_final_production.csv');
  const map = {};
  if (!fs.existsSync(csvPath)) return map;

  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter((line) => line.trim());
  const headers = parseCSVLine(lines[0]);

  lines.slice(1).forEach((line) => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || '';
    });
    if (row['Supplier Name']) map[row['Supplier Name']] = row;
  });

  return map;
}

function localImageExists(relativePath, cwd) {
  if (!relativePath || !relativePath.startsWith('/media/')) return false;
  return fs.existsSync(path.join(cwd, 'public', relativePath.replace(/^\//, '')));
}

function resolveImages(rawImages, csvRow, cwd) {
  const fromDisk = (rawImages || []).filter(
    (img) => img && (img.startsWith('http') || localImageExists(img, cwd))
  );
  if (fromDisk.length) return fromDisk;

  const external = [
    cleanValue(csvRow?.['Google Image']),
    cleanValue(csvRow?.['Main Image']),
  ].filter((url) => url.startsWith('http'));

  return external;
}

function mapJsonItem(item, csvRow, cwd) {
  const images = resolveImages(item.images, csvRow, cwd);
  const googleImage = cleanValue(csvRow?.['Google Image']) || cleanValue(item.google_image);

  return {
    'Supplier Name': item.name || '',
    'Phone Number': item.phone || '',
    Category: item.category || '',
    URL: item.engaged_url || '',
    'Main Image': images[0] || googleImage,
    'Google Image': googleImage,
    Gallery: images.join(','),
    'Real Phone': item.real_phone || item.phone || '',
    Website: item.website || '',
    'Google Reviews Link': csvRow?.['Google Reviews Link'] || item.google_reviews_link || '',
    'Google Rating': cleanValue(item.google_rating) || cleanValue(csvRow?.['Google Rating']),
    'Reviews Count': cleanValue(item.reviews_count) || cleanValue(csvRow?.['Reviews Count']),
    Address: item.address || '',
    description: item.description || '',
    reviews: item.reviews || [],
    images,
  };
}

export function loadSuppliersFromJson(cwd = process.cwd()) {
  const jsonPath = path.join(cwd, 'data', 'suppliers_complete.json');
  if (!fs.existsSync(jsonPath)) return { list: [], byName: {}, byPhone: {} };

  const csvByName = loadCsvByName(cwd);
  const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const list = rawData
    .map((item) => mapJsonItem(item, csvByName[item.name], cwd))
    .filter((item) => {
      const phone = item['Real Phone'] || item['Phone Number'];
      return phone && phone !== 'FAILED' && phone !== 'N/A';
    });

  const byName = {};
  const byPhone = {};
  list.forEach((item) => {
    if (item['Supplier Name']) byName[item['Supplier Name']] = item;
    const phone = normalizePhone(item['Real Phone'] || item['Phone Number']);
    if (phone) byPhone[phone] = item;
  });

  return { list, byName, byPhone };
}

export function enrichSupplierRecord(supplier, maps) {
  const name = supplier['Supplier Name'] || supplier.name || '';
  const phone = normalizePhone(supplier['Real Phone'] || supplier['Phone Number'] || supplier.phone);
  const enriched = maps.byName[name] || maps.byPhone[phone];

  const images = (supplier.images?.length ? supplier.images : enriched?.images) || [];
  const reviews = (supplier.reviews?.length ? supplier.reviews : enriched?.reviews) || [];
  const mainImage =
    cleanValue(supplier['Main Image']) ||
    cleanValue(supplier['Google Image']) ||
    images[0] ||
    cleanValue(enriched?.['Main Image']);

  return {
    ...supplier,
    'Supplier Name': name || enriched?.['Supplier Name'] || '',
    'Phone Number': supplier['Phone Number'] || enriched?.['Phone Number'] || '',
    'Real Phone': supplier['Real Phone'] || enriched?.['Real Phone'] || supplier['Phone Number'] || '',
    Category: supplier.Category || enriched?.Category || '',
    URL: supplier.URL || enriched?.URL || '',
    Website: supplier.Website || enriched?.Website || '',
    Address: supplier.Address || enriched?.Address || '',
    'Google Rating': cleanValue(supplier['Google Rating']) || cleanValue(enriched?.['Google Rating']),
    'Reviews Count': cleanValue(supplier['Reviews Count']) || cleanValue(enriched?.['Reviews Count']),
    'Google Reviews Link': supplier['Google Reviews Link'] || enriched?.['Google Reviews Link'] || '',
    'Main Image': mainImage,
    'Google Image': cleanValue(supplier['Google Image']) || cleanValue(enriched?.['Google Image']),
    description: supplier.description || enriched?.description || '',
    reviews,
    images: images.length ? images : enriched?.images || [],
  };
}
