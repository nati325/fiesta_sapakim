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

function loadAuxMaps(cwd) {
  const maps = { reviews: {}, images: {}, descriptions: {} };
  const reviewsPath = path.join(cwd, 'data', 'supplier_reviews.json');
  const imagesPath = path.join(cwd, 'data', 'supplier_images.json');
  const descPath = path.join(cwd, 'data', 'supplier_descriptions.json');

  if (fs.existsSync(reviewsPath)) {
    try {
      maps.reviews = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
    } catch {
      maps.reviews = {};
    }
  }
  if (fs.existsSync(imagesPath)) {
    try {
      maps.images = JSON.parse(fs.readFileSync(imagesPath, 'utf-8'));
    } catch {
      maps.images = {};
    }
  }
  if (fs.existsSync(descPath)) {
    try {
      maps.descriptions = JSON.parse(fs.readFileSync(descPath, 'utf-8'));
    } catch {
      maps.descriptions = {};
    }
  }

  return maps;
}

function loadCsvRows(cwd) {
  const csvPath = path.join(cwd, 'scraping', 'engaged_suppliers_final_production.csv');
  if (!fs.existsSync(csvPath)) return [];

  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter((line) => line.trim());
  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || '';
    });
    return row;
  });
}

function loadCsvByName(cwd) {
  const map = {};
  loadCsvRows(cwd).forEach((row) => {
    if (row['Supplier Name']) map[row['Supplier Name']] = row;
  });
  return map;
}

function loadCsvIndexes(cwd) {
  const byName = {};
  const byPhone = {};

  loadCsvRows(cwd).forEach((row) => {
    if (row['Supplier Name']) byName[row['Supplier Name']] = row;
    const phone = normalizePhone(row['Real Phone'] || row['Phone Number']);
    if (phone) byPhone[phone] = row;
  });

  return { byName, byPhone };
}

function resolveCsvRow(item, csvByName, csvByPhone) {
  if (!item) return null;

  const direct = csvByName[item.name];
  if (direct) return direct;

  const phone = normalizePhone(item.real_phone || item.phone);
  if (phone && csvByPhone[phone]) return csvByPhone[phone];

  if (item.clean_name) {
    const match = Object.values(csvByName).find((row) => {
      const rowName = row['Supplier Name'] || '';
      return rowName.startsWith(item.clean_name) || rowName.includes(item.clean_name);
    });
    if (match) return match;
  }

  return null;
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

function readJsonArray(jsonPath) {
  if (!fs.existsSync(jsonPath)) return null;

  let content = fs.readFileSync(jsonPath, 'utf-8');
  if (content.includes('<<<<<<<')) {
    content = content.replace(
      /<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n[\s\S]*?>>>>>>> origin\/main\r?\n/g,
      '$1'
    );
    fs.writeFileSync(jsonPath, content, 'utf8');
    console.log(`Repaired merge conflicts in ${jsonPath}`);
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to parse ${jsonPath}:`, error.message);
    return null;
  }
}

function mapJsonItem(item, csvRow, auxMaps, cwd) {
  const name = cleanValue(item.name) || cleanValue(csvRow?.['Supplier Name']) || cleanValue(item.clean_name) || '';
  const imagesFromJson = resolveImages(item.images, csvRow, cwd);
  const imagesFromMap = (auxMaps.images[name]?.downloaded_images || []).filter(
    (img) => img && img !== 'nan' && (img.startsWith('http') || localImageExists(img, cwd))
  );
  const images = imagesFromJson.length ? imagesFromJson : resolveImages(imagesFromMap, csvRow, cwd);
  const googleImage = cleanValue(csvRow?.['Google Image']) || cleanValue(item.google_image);

  const description =
    item.description ||
    auxMaps.descriptions[name]?.description ||
    (typeof auxMaps.descriptions[name] === 'string' ? auxMaps.descriptions[name] : '');

  return normalizeSupplierRecord({
    id: item.id,
    clean_name: cleanValue(item.clean_name) || cleanValue(csvRow?.['Supplier Name']?.split('|')[0]) || name.split('|')[0]?.trim() || '',
    'Supplier Name': name,
    'Phone Number': item.phone || csvRow?.['Phone Number'] || '',
    Category: item.category || csvRow?.Category || '',
    URL: item.engaged_url || csvRow?.URL || '',
    'Main Image': images[0] || googleImage || cleanValue(csvRow?.['Main Image']),
    'Google Image': googleImage,
    Gallery: images.join(','),
    'Real Phone': item.real_phone || csvRow?.['Real Phone'] || item.phone || '',
    Website: item.website || csvRow?.Website || '',
    'Google Reviews Link': csvRow?.['Google Reviews Link'] || item.google_reviews_link || '',
    'Google Rating': cleanValue(item.google_rating) || cleanValue(csvRow?.['Google Rating']),
    'Reviews Count': cleanValue(item.reviews_count) || cleanValue(csvRow?.['Reviews Count']),
    Address: item.address || csvRow?.Address || '',
    description,
    reviews: item.reviews?.length ? item.reviews : auxMaps.reviews[name] || [],
    images,
  });
}

function mapCsvRow(row, auxMaps, cwd) {
  const name = row['Supplier Name'] || '';
  const rawImages = (auxMaps.images[name]?.downloaded_images || []).filter(Boolean);
  const images = resolveImages(rawImages, row, cwd);

  return normalizeSupplierRecord({
    'Supplier Name': name,
    'Phone Number': row['Phone Number'] || '',
    Category: row.Category || '',
    URL: row.URL || '',
    'Main Image': images[0] || cleanValue(row['Google Image']) || cleanValue(row['Main Image']),
    'Google Image': cleanValue(row['Google Image']),
    Gallery: images.join(','),
    'Real Phone': row['Real Phone'] || row['Phone Number'] || '',
    Website: row.Website || '',
    'Google Reviews Link': row['Google Reviews Link'] || '',
    'Google Rating': cleanValue(row['Google Rating']),
    'Reviews Count': cleanValue(row['Reviews Count']),
    Address: row.Address || '',
    description:
      auxMaps.descriptions[name]?.description ||
      (typeof auxMaps.descriptions[name] === 'string' ? auxMaps.descriptions[name] : ''),
    reviews: auxMaps.reviews[name] || [],
    images,
  });
}

export function normalizeSupplierRecord(supplier) {
  const name = cleanValue(
    supplier['Supplier Name'] ||
    supplier.name ||
    supplier.Name ||
    supplier.clean_name ||
    ''
  );

  const realPhone = cleanValue(
    supplier['Real Phone'] ||
    supplier.real_phone ||
    supplier.phone ||
    supplier['Phone Number'] ||
    ''
  );

  const cleanName = cleanValue(
    supplier.clean_name ||
    name.split('|')[0]?.trim() ||
    name
  );

  const images = (supplier.images || []).filter(Boolean);
  const mainImage =
    cleanValue(supplier['Main Image']) ||
    cleanValue(supplier['Google Image']) ||
    images.find((img) => img.startsWith('http')) ||
    images[0] ||
    '';

  return {
    ...supplier,
    id: supplier.id ?? supplier.supplierId ?? null,
    clean_name: cleanName,
    'Supplier Name': name || cleanName || 'ספק ללא שם',
    name: name || cleanName || 'ספק ללא שם',
    'Phone Number': supplier['Phone Number'] || supplier.phone || '',
    'Real Phone': realPhone,
    phone: realPhone,
    Category: supplier.Category || supplier.category || '',
    category: supplier.Category || supplier.category || '',
    URL: supplier.URL || supplier.engaged_url || '',
    Website: supplier.Website || supplier.website || '',
    Address: supplier.Address || supplier.address || '',
    'Main Image': mainImage,
    'Google Image': cleanValue(supplier['Google Image']),
    description: supplier.description || '',
    reviews: supplier.reviews || [],
    images,
  };
}

function buildMaps(list) {
  const byName = {};
  const byPhone = {};
  list.forEach((item) => {
    if (item['Supplier Name']) byName[item['Supplier Name']] = item;
    const phone = normalizePhone(item['Real Phone'] || item['Phone Number']);
    if (phone) byPhone[phone] = item;
  });
  return { list, byName, byPhone };
}

function filterValidPhone(list) {
  return list.filter((item) => {
    const phone = item['Real Phone'] || item['Phone Number'];
    const name = item['Supplier Name'] || item.clean_name || item.name;
    return phone && phone !== 'FAILED' && phone !== 'N/A' && cleanValue(name);
  });
}

function dedupeByPhone(list) {
  const byPhone = new Map();

  const score = (item) => {
    let points = 0;
    if (item['Supplier Name']?.trim()) points += 10;
    if (item.clean_name?.trim()) points += 5;
    if (item.Category?.trim()) points += 3;
    if (item.description?.trim()) points += 2;
    if (item.images?.length) points += item.images.length;
    if (item.reviews?.length) points += item.reviews.length;
    return points;
  };

  for (const item of list) {
    const phoneKey = normalizePhone(item['Real Phone'] || item['Phone Number']);
    if (!phoneKey) continue;

    const existing = byPhone.get(phoneKey);
    if (!existing || score(item) > score(existing)) {
      byPhone.set(phoneKey, item);
    }
  }

  return Array.from(byPhone.values());
}

export function loadSuppliersFromCsv(cwd = process.cwd()) {
  const auxMaps = loadAuxMaps(cwd);
  const list = filterValidPhone(loadCsvRows(cwd).map((row) => mapCsvRow(row, auxMaps, cwd)));
  return buildMaps(list);
}

export function loadSuppliersFromJson(cwd = process.cwd()) {
  const jsonPath = path.join(cwd, 'data', 'suppliers_complete.json');
  const { byName: csvByName, byPhone: csvByPhone } = loadCsvIndexes(cwd);
  const auxMaps = loadAuxMaps(cwd);
  const rawData = readJsonArray(jsonPath);

  if (!rawData || !Array.isArray(rawData)) {
    return loadSuppliersFromCsv(cwd);
  }

  const list = dedupeByPhone(
    filterValidPhone(
      rawData.map((item) => {
        const csvRow = resolveCsvRow(item, csvByName, csvByPhone);
        return mapJsonItem(item, csvRow, auxMaps, cwd);
      })
    )
  );

  if (list.length === 0) {
    return loadSuppliersFromCsv(cwd);
  }

  return buildMaps(list);
}

export function enrichSupplierRecord(supplier, maps) {
  const normalized = normalizeSupplierRecord(supplier);
  const name = normalized['Supplier Name'];
  const phone = normalizePhone(normalized['Real Phone'] || normalized['Phone Number']);
  const enriched = maps.byName[name] || maps.byPhone[phone];

  if (!enriched) return normalized;

  return normalizeSupplierRecord({
    ...enriched,
    ...normalized,
    description: normalized.description || enriched.description,
    reviews: normalized.reviews?.length ? normalized.reviews : enriched.reviews,
    images: normalized.images?.length ? normalized.images : enriched.images,
  });
}
