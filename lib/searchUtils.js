function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u05F3\u05F4'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j], row[j - 1], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function tokenMatchesName(token, nameText) {
  if (!token || !nameText) return false;
  if (nameText.includes(token)) return true;
  if (token.length < 3) return false;

  const words = nameText.split(/[\s|,\-]+/).filter(Boolean);
  for (const word of words) {
    if (word.includes(token)) return true;
    if (token.includes(word) && word.length >= 3) return true;
    if (word.length >= 3 && levenshtein(token, word) <= 1) return true;
  }

  return levenshtein(token, nameText.slice(0, token.length + 2)) <= 1;
}

export function supplierMatchesSearch(supplier, rawQuery, supplierIndex = null) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return true;

  const nameText = normalizeSearchText(
    [supplier['Supplier Name'], supplier.name, supplier.clean_name, supplier['Name']]
      .filter(Boolean)
      .join(' ')
  );

  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length > 0 && nameText) {
    if (tokens.every((token) => tokenMatchesName(token, nameText))) return true;
  }

  const category = normalizeSearchText(supplier.Category || supplier.category);
  if (category && category.includes(query)) return true;

  const cleanQuery = query.replace(/[-\s]/g, '');
  const realPhoneClean = String(supplier['Real Phone'] || '').replace(/[-\s]/g, '');
  const phoneClean = String(supplier['Phone Number'] || supplier.phone || '').replace(/[-\s]/g, '');

  if (cleanQuery && realPhoneClean.includes(cleanQuery)) return true;
  if (cleanQuery && phoneClean.includes(cleanQuery)) return true;

  if (supplierIndex !== null) {
    const indexText = String(supplierIndex);
    if (query === indexText || query === `#${indexText}` || query === `ספק ${indexText}`) {
      return true;
    }
  }

  return false;
}

export function dedupeSuppliersByPhone(list) {
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
    const phoneKey = String(item['Real Phone'] || item['Phone Number'] || '').replace(/\D/g, '');
    if (!phoneKey) continue;

    const existing = byPhone.get(phoneKey);
    if (!existing || score(item) > score(existing)) {
      byPhone.set(phoneKey, item);
    }
  }

  return Array.from(byPhone.values());
}
