export function mapCategoryToFiesta(category) {
  if (!category) return 'design';
  const cat = String(category).toLowerCase();
  if (cat.includes('מוזיקה') || cat.includes('dj') || cat.includes('די ג') || cat.includes('תקליטן')) {
    return 'dj';
  }
  if (cat.includes('אולמות') || cat.includes('גן אירועים') || cat.includes('גני אירועים')) {
    return 'venue';
  }
  if (cat.includes('מאפרות') || cat.includes('איפור')) return 'makeup';
  if (cat.includes('שיער')) return 'hair';
  if (cat.includes('כלות') || cat.includes('חתן ולכלה')) return 'dresses';
  if (cat.includes('צילום')) return 'photographer';
  if (cat.includes('קייטרינג')) return 'catering';
  if (cat.includes('בר אלכוהול') || cat.includes('אלכוהול')) return 'alcohol';
  if (cat.includes('בר')) return 'bar';
  if (cat.includes('חליפות') || cat.includes('חתן')) return 'suits';
  if (cat.includes('עיצוב')) return 'design';
  if (cat.includes('הסעות') || cat.includes('תחבורה')) return 'transportation';
  if (cat.includes('זמר') || cat.includes('להקה')) return 'singers';
  if (cat.includes('אטרקציה')) return 'attractions';
  if (cat.includes('הפקה')) return 'event-production';
  return 'design';
}

export function extractRegionFromAddress(address) {
  const regionMatch = String(address || '').match(/[\u05D0-\u05EA]{2,}/);
  return regionMatch ? regionMatch[0] : '';
}

export function collectSupplierImages(supplier) {
  let supplierImages = [];
  if (supplier.images && Array.isArray(supplier.images)) {
    supplierImages = [...supplier.images];
  }

  const main = supplier['Main Image'];
  if (main && main !== 'N/A' && main !== 'nan' && !supplierImages.includes(main)) {
    supplierImages.unshift(main);
  }

  const google = supplier['Google Image'];
  if (google && google !== 'N/A' && google !== 'nan' && !supplierImages.includes(google)) {
    supplierImages.push(google);
  }

  const gallery = supplier.Gallery;
  if (gallery && gallery !== 'N/A' && gallery !== 'nan') {
    gallery
      .split(/[,|]/)
      .filter((img) => img && img !== 'N/A' && img !== 'nan')
      .forEach((img) => {
        const value = img.trim();
        if (value && !supplierImages.includes(value)) supplierImages.push(value);
      });
  }

  return supplierImages.filter((img) => img && img.trim() !== '' && img !== 'N/A' && img !== 'nan');
}
