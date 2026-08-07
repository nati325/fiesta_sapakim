/**
 * Maps scraped / agent category signals → Fiesta site type slugs.
 * Uses name + description + category so "לחתן ולכלה" + מאפרת → makeup, not dresses.
 */
/** Direct slug passthrough from CSV imports (weekend batch uses English slugs). */
const FIESTA_SLUG_ALIASES = {
  venue: 'venue',
  dj: 'dj',
  photographer: 'photographer',
  catering: 'catering',
  makeup: 'makeup',
  dresses: 'dresses',
  suits: 'suits',
  hair: 'hair',
  design: 'design',
  alcohol: 'alcohol',
  bar: 'bar',
  rings: 'rings',
  invitations: 'invitations',
  attractions: 'attractions',
  'event-production': 'event-production',
  rabbi: 'rabbi',
  hotels: 'hotels',
  bachelor: 'bachelor',
  singers: 'singers',
  challa: 'challa',
  arrivals: 'transportation',
  transportation: 'transportation',
  cars: 'cars',
  'getting-ready': 'getting-ready',
  'bride-shoes': 'bride-shoes',
  'groom-shoes': 'groom-shoes',
  'equipment-rental': 'equipment-rental',
  rsvp: 'rsvp',
  cantors: 'cantors',
  'religious-bands': 'religious-bands',
  souvenirs: 'souvenirs',
  dietitians: 'dietitians',
  'personal-training': 'personal-training',
};

const HEBREW_CATEGORY_SLUG = {
  'הפרשת חלה': 'challa',
  'ארגון חתונה': 'event-production',
  'קייטרינג': 'catering',
  'שמלות כלה': 'dresses',
  'עיצוב שיער': 'hair',
  'עיצוב אירועים': 'design',
  'טבעות נישואין': 'rings',
  'הזמנות': 'invitations',
  'אטרקציות': 'attractions',
  'הפקת אירועים': 'event-production',
  'אלכוהול ובר': 'alcohol',
  'איפור': 'makeup',
  'צילום': 'photographer',
  'מוזיקה': 'dj',
  'רב לחופה': 'rabbi',
  'אולמות וגנים': 'venue',
  'מסיבות רווקים': 'bachelor',
  'חליפות חתן': 'suits',
  'הסעות': 'transportation',
  'מלונות': 'hotels',
  'זמרים ולהקות': 'singers',
};

export function mapCategoryToFiesta(category, supplier = null) {
  const catRaw = String(category || '').trim();
  const catSlug = catRaw.toLowerCase();
  if (FIESTA_SLUG_ALIASES[catSlug]) return FIESTA_SLUG_ALIASES[catSlug];
  if (HEBREW_CATEGORY_SLUG[catRaw]) return HEBREW_CATEGORY_SLUG[catRaw];

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
    ['photographer', ['צילום', 'צלם', 'צלמ', 'וידאו', 'סושיאל', 'photographer']],
    ['catering', ['קייטרינג', 'catering']],
    ['alcohol', ['בר אלכוהול', 'אלכוהול', 'alcohol']],
    ['bar', ['שירותי בר', 'ברן', 'ברמ']],
    ['design', ['עיצוב אירוע', 'עיצוב אירועים', 'עיצוב']],
    ['transportation', ['הסעות', 'תחבורה', 'arrivals']],
    ['cars', ['רכבי יוקרה', 'לימוזין']],
    ['singers', ['זמר', 'להקה', 'singers']],
    ['attractions', ['אטרקציה', 'אטרקציות', 'attractions']],
    ['event-production', ['הפקת אירוע', 'הפקת אירועים', 'הפקה', 'ארגון חתונה']],
    ['rings', ['טבעות', 'rings']],
    ['invitations', ['הזמנות', 'invitations']],
    ['rabbi', ['רב לחופה', 'רב ']],
    ['hotels', ['מלון', 'מלונות', 'hotels']],
    ['getting-ready', ['התארגנות']],
    ['bride-shoes', ['נעלי כלה']],
    ['groom-shoes', ['נעלי חתן']],
    ['bachelor', ['מסיבות רווקים', 'bachelor']],
    ['challa', ['הפרשת חלה', 'challa']],
  ];

  for (const [type, keywords] of rules) {
    if (keywords.some((kw) => text.includes(kw))) return type;
  }

  const cat = String(category || '').toLowerCase();
  if (cat.includes('חתן ולכלה') || cat.includes('כלות')) return 'dresses';
  if (cat.includes('חתן')) return 'suits';
  return 'design';
}

export const FIESTA_REGIONS = ['מרכז', 'צפון', 'דרום', 'כל הארץ'];

const NORTH_HINTS = [
  'צפון', 'חיפה', 'נהריה', 'עכו', 'כרמיאל', 'נצרת', 'טבריה', 'צפת', 'קריות',
  'קריית', 'יוקנעם', 'עפולה', 'מגדל העמק', 'ראש פינה', 'נהרייה',
];
const SOUTH_HINTS = [
  'דרום', 'באר שבע', 'אילת', 'אשדוד', 'אשקלון', 'דימונה', 'ערד', 'שדרות',
  'נתיבות', 'אופקים', 'ירוחם', 'מצפה רמון', 'קרית גת', 'קריית גת',
];
const CENTER_HINTS = [
  'מרכז', 'תל אביב', 'ת״א', 'ת"א', 'רמת גן', 'גבעתיים', 'חולון', 'בת ים',
  'ראשון', 'רחובות', 'פתח תקווה', 'פתח תקוה', 'נתניה', 'הרצליה', 'רעננה',
  'כפר סבא', 'הוד השרון', 'רמת השרון', 'מודיעין', 'ירושלים', 'בית שמש',
  'נס ציונה', 'לוד', 'רמלה', 'שוהם', 'גדרה', 'יבנה', 'אור יהודה', 'יהוד',
  'שרון', 'שפלה', 'גוש דן',
];

/**
 * Map a free-text address to one of the four site regions, or '' if unclear.
 * Used only as a default for the agent select — the agent can override.
 */
export function extractRegionFromAddress(address) {
  const text = String(address || '').trim();
  if (!text) return '';

  const lower = text.toLowerCase();
  // Explicit "כל הארץ" / nationwide
  if (/כל\s*הארץ|nationwide|israel-wide|כל הארץ/.test(text)) return 'כל הארץ';

  const hit = (hints) => hints.some((h) => text.includes(h) || lower.includes(h.toLowerCase()));
  if (hit(NORTH_HINTS)) return 'צפון';
  if (hit(SOUTH_HINTS)) return 'דרום';
  if (hit(CENTER_HINTS)) return 'מרכז';
  return '';
}

export function normalizeFiestaRegion(value) {
  const v = String(value || '').trim();
  if (FIESTA_REGIONS.includes(v)) return v;
  return extractRegionFromAddress(v) || '';
}

/** Unique list of allowed Fiesta regions from form / overrides. */
export function normalizeFiestaRegions(list, fallback = '') {
  const fromList = (Array.isArray(list) ? list : [])
    .map((r) => normalizeFiestaRegion(r))
    .filter(Boolean);
  const primary = normalizeFiestaRegion(fallback);
  const merged = [...new Set([...fromList, ...(primary ? [primary] : [])])];
  return merged;
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
