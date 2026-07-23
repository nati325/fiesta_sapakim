/**
 * Maps scraped / agent category signals → Fiesta site type slugs.
 * Uses name + description + category so "לחתן ולכלה" + מאפרת → makeup, not dresses.
 */
export function mapCategoryToFiesta(category, supplier = null) {
  const text = [
    category,
    supplier?.Category,
    supplier?.category,
    supplier?.['Supplier Name'],
    supplier?.name,
    supplier?.clean_name,
    supplier?.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const rules = [
    ['makeup', ['מאפר', 'איפור', 'makeup', 'mua']],
    ['hair', ['מסרק', 'תסרוק', 'עיצוב שיער', 'hair style', 'hair', 'צמות', 'braids']],
    ['dresses', ['שמלות כלה', 'שמלת כלה', 'bridal dress', 'bridal gown', 'gown']],
    ['suits', ['חליפות חתן', 'חליפת חתן', 'חליפות בוטיק']],
    ['dj', ['מוזיקה', 'dj', 'די ג', 'דיג׳י', 'דיגיי', 'תקליטן', 'תקליטנ']],
    ['venue', ['אולמות', 'גן אירועים', 'גני אירועים', 'מתחם אירועים']],
    ['photographer', ['צילום', 'צלם', 'צלמ', 'וידאו', 'סושיאל']],
    ['catering', ['קייטרינג']],
    ['alcohol', ['בר אלכוהול', 'אלכוהול']],
    ['bar', ['שירותי בר', 'ברן', 'ברמ']],
    ['design', ['עיצוב אירוע', 'עיצוב אירועים', 'עיצוב']],
    ['transportation', ['הסעות', 'תחבורה']],
    ['cars', ['רכבי יוקרה', 'לימוזין']],
    ['singers', ['זמר', 'להקה']],
    ['attractions', ['אטרקציה', 'אטרקציות']],
    ['event-production', ['הפקת אירוע', 'הפקת אירועים', 'הפקה']],
    ['rings', ['טבעות']],
    ['invitations', ['הזמנות']],
    ['rabbi', ['רב לחופה', 'רב ']],
    ['hotels', ['מלון', 'מלונות']],
    ['getting-ready', ['התארגנות']],
    ['bride-shoes', ['נעלי כלה']],
    ['groom-shoes', ['נעלי חתן']],
  ];

  for (const [type, keywords] of rules) {
    if (keywords.some((kw) => text.includes(kw))) return type;
  }

  const cat = String(category || '').toLowerCase();
  if (cat.includes('חתן ולכלה') || cat.includes('כלות')) return 'dresses';
  if (cat.includes('חתן')) return 'suits';
  return 'design';
}

export function extractRegionFromAddress(address) {
  const regionMatch = String(address || '').match(/[\u05D0-\u05EA]{2,}/);
  return regionMatch ? regionMatch[0] : '';
}

export function getSupplierDescription(supplier) {
  if (!supplier) return '';
  const raw =
    supplier.description ||
    supplier.Description ||
    supplier['Description'] ||
    '';
  const cleaned = String(raw).trim();
  if (!cleaned || cleaned === 'nan' || cleaned === 'N/A' || cleaned === 'FAILED') return '';
  return cleaned;
}

export function buildDefaultDescription(supplier) {
  const scraped = getSupplierDescription(supplier);
  if (scraped) return scraped;

  const category = supplier?.Category || supplier?.category || '';
  const address = supplier?.Address || supplier?.address || '';
  const fallback = `${category} באזור ${address}`.trim();
  return fallback === 'באזור' ? '' : fallback;
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

  const google = supplier['Google Image'] || supplier.google_image;
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

  for (const item of supplier.portfolio || []) {
    const value = typeof item === 'string' ? item : item?.image;
    if (value && value !== 'N/A' && value !== 'nan' && !supplierImages.includes(value)) {
      supplierImages.push(value);
    }
  }

  return supplierImages.filter(
    (img) => img && String(img).trim() !== '' && img !== 'N/A' && img !== 'nan'
  );
}
