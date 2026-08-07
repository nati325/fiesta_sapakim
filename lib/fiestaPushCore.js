import {
  pickMainImage,
  toPortfolioItems,
  prepareAgreementImages,
  prepareFiestaImage,
} from './fiestaImages.js';
import {
  buildDefaultDescription,
  extractRegionFromAddress,
  mapCategoryToFiesta,
  normalizeFiestaRegion,
} from './fiestaCategoryMap.js';
import { normalizeReviewsList } from './supplierEnrichment.js';

/** Native-driver Collection → Db (Fiesta cluster only — never the CRM db). */
function dbFromVendorsCollection(vendorsCollection) {
  return vendorsCollection?.s?.db || vendorsCollection?.client?.db?.(vendorsCollection.dbName) || null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Allow optional separators between digits: 0523300403 matches 052-330-0403 */
function flexiblePhoneRegex(phoneDigits) {
  if (!phoneDigits || phoneDigits.length < 9) return null;
  return phoneDigits.split('').map(escapeRegex).join('[^0-9]*');
}

export function buildDefaultFiestaData(supplier, overrides = {}) {
  const address = supplier.Address || supplier.address || '';
  const category = supplier.Category || supplier.category || '';
  const images = overrides.selectedImages || overrides.images || [];
  const scrapedDescription = buildDefaultDescription(supplier);
  const overrideDescription =
    overrides.description !== undefined && overrides.description !== null
      ? String(overrides.description).trim()
      : '';

  // Prefer agent text when they typed something real; otherwise scraped description.
  // Ignore legacy auto-template "קטגוריה באזור ..."
  const looksLikeAutoTemplate =
    overrideDescription &&
    category &&
    overrideDescription === `${category} באזור ${address}`.trim();

  const description =
    (overrideDescription && !looksLikeAutoTemplate ? overrideDescription : '') ||
    scrapedDescription ||
    overrideDescription ||
    '';

  return {
    type: overrides.type || mapCategoryToFiesta(category, supplier),
    types: Array.isArray(overrides.types)
      ? overrides.types.filter(Boolean)
      : overrides.type
        ? [overrides.type]
        : [],
    description,
    region: normalizeFiestaRegion(overrides.region || extractRegionFromAddress(address)),
    originalPrice: overrides.originalPrice || '0',
    price: overrides.price || '0',
    discount: overrides.discount || '0',
    discountType: overrides.discountType || 'percent',
    commissionAmount: Number(overrides.commissionAmount) || 0,
    commissionPercent: Number(overrides.commissionPercent) || 0,
    agreementSigned: overrides.agreementSigned ?? true,
    agreementImage: overrides.agreementImage || '',
    agreementImages: Array.isArray(overrides.agreementImages)
      ? overrides.agreementImages.filter(Boolean).slice(0, 3)
      : overrides.agreementImage
        ? [overrides.agreementImage]
        : [],
    products: Array.isArray(overrides.products) ? overrides.products : [],
    mainProductId: overrides.mainProductId || '',
    selectedImages: images,
    images,
    reviews: normalizeReviewsList(overrides.reviews ?? supplier.reviews),
    agentName: overrides.agentName || 'bulk-push',
  };
}

export async function findExistingVendor(vendorsCollection, supplier) {
  const supplierName = (supplier['Supplier Name'] || supplier.name || '').trim();
  const supplierPhone = digitsOnly(supplier['Real Phone'] || supplier.phone || '');

  if (!supplierName && !supplierPhone) return null;

  const or = [];
  if (supplierName) {
    try {
      or.push({ name: { $regex: new RegExp(`^${escapeRegex(supplierName)}$`, 'i') } });
    } catch {
      or.push({ name: supplierName });
    }
  }

  const phonePattern = flexiblePhoneRegex(supplierPhone);
  if (phonePattern) {
    try {
      or.push({ contact: { $regex: phonePattern } });
    } catch {
      // ignore bad phone pattern — fallback scan below may still match
    }
  }

  if (!or.length) return null;

  const match = await vendorsCollection.findOne({ $or: or });
  if (match) return match;

  // Fallback: scan recent vendors with digit-normalized contact equality
  if (supplierPhone.length >= 9) {
    const candidates = await vendorsCollection
      .find({ contact: { $exists: true, $ne: '' } })
      .project({ name: 1, contact: 1 })
      .limit(5000)
      .toArray();
    return (
      candidates.find((v) => {
        const d = digitsOnly(v.contact);
        return d === supplierPhone || d.endsWith(supplierPhone.slice(-9)) || supplierPhone.endsWith(d.slice(-9));
      }) || null
    );
  }

  return null;
}

/**
 * The push writes to the Fiesta database with the native driver, bypassing the
 * Vendor Mongoose model — so none of the schema defaults apply here and every
 * field has to be spelled out. Keep this in step with the `products` subdocument
 * in `Fiesta/fiesta-nextjs/lib/models/Vendor.js`.
 */
async function normalizeProducts(list, { origin, db } = {}) {
  if (!Array.isArray(list)) return [];
  return Promise.all(
    list.map(async (p, i) => ({
      id: String(p?.id || `p${i + 1}`),
      name: String(p?.name || '').trim(),
      description: String(p?.description || '').trim(),
      price: String(p?.price ?? '0'),
      originalPrice: String(p?.originalPrice ?? p?.price ?? '0'),
      image: await prepareFiestaImage(p?.image || '', origin, db),
      kind: p?.kind === 'addon' ? 'addon' : 'main',
      commissionAmount: Number(p?.commissionAmount) || 0,
      order: Number.isFinite(Number(p?.order)) ? Number(p.order) : i,
      active: p?.active !== false,
    }))
  );
}

async function buildVendorFields({ supplier, fiestaData, origin, db }) {
  const supplierName = (supplier['Supplier Name'] || supplier.name || '').trim();
  const selectedImages = (fiestaData.selectedImages || fiestaData.images || supplier.images || []).filter(
    (img) => {
      if (img == null) return false;
      if (typeof img === 'number') return false;
      const s = String(img).trim();
      if (!s || /^\d+$/.test(s)) return false;
      return (
        s.startsWith('http://') ||
        s.startsWith('https://') ||
        s.startsWith('/media/') ||
        s.startsWith('data:image/')
      );
    }
  );
  const reviewList = normalizeReviewsList(fiestaData.reviews ?? supplier.reviews);

  const mainImage =
    (await pickMainImage({ ...supplier, images: selectedImages }, origin, selectedImages, db)) ||
    (await pickMainImage(supplier, origin, null, db));

  const portfolio = await toPortfolioItems(
    selectedImages.length ? selectedImages : supplier.images || [],
    origin,
    db
  );

  const agreementSource = Array.isArray(fiestaData.agreementImages) && fiestaData.agreementImages.length
    ? fiestaData.agreementImages
    : fiestaData.agreementImage
      ? [fiestaData.agreementImage]
      : [];
  const agreementImages = await prepareAgreementImages(agreementSource, origin, db);
  const agreementImage = agreementImages[0] || '';

  const products = await normalizeProducts(fiestaData.products, { origin, db });

  const primaryType =
    fiestaData.type ||
    (Array.isArray(fiestaData.types) && fiestaData.types[0]) ||
    mapCategoryToFiesta(supplier.Category || supplier.category, supplier);
  const types = [...new Set(
    [primaryType, ...(Array.isArray(fiestaData.types) ? fiestaData.types : [])]
      .map((t) => String(t || '').trim())
      .filter(Boolean)
  )];

  return {
    name: supplierName,
    type: primaryType,
    types,
    description:
      fiestaData.description ||
      buildDefaultDescription(supplier) ||
      '',
    contact: supplier['Real Phone'] || supplier.phone || '',
    image: mainImage,
    region: normalizeFiestaRegion(fiestaData.region || ''),
    price: String(fiestaData.price ?? '0'),
    originalPrice: String(fiestaData.originalPrice || fiestaData.price || '0'),
    discount: String(fiestaData.discount || '0'),
    discountType: fiestaData.discountType || 'percent',
    commissionAmount: Number(fiestaData.commissionAmount) || 0,
    commissionPercent: Number(fiestaData.commissionPercent) || 0,
    agreementSigned: Boolean(fiestaData.agreementSigned),
    agreementImage,
    agreementImages,
    googleReviewsLink:
      supplier['Google Reviews Link'] || supplier.google_reviews_link || '',
    googleRating:
      parseFloat(supplier['Google Rating'] || supplier.google_rating) || 5,
    googleReviewsCount:
      parseInt(supplier['Reviews Count'] || supplier.reviews_count, 10) || 0,
    adminNotes: [
      `✅ נוסף/עודכן אוטומטית על ידי סוכן: ${fiestaData.agentName || 'לא ידוע'}`,
      `📍 כתובת: ${supplier.Address || supplier.address || 'אין'}`,
      `🌐 אתר: ${supplier.Website || supplier.website || 'אין'}`,
      `🏷️ קטגוריה מקורית: ${supplier.Category || supplier.category || 'לא צוין'}`,
      `🏷️ קטגוריות אתר: ${types.join(', ') || primaryType || ''}`,
      `🏢 עמלת Fiesta: ${fiestaData.commissionPercent || 0}% (₪${fiestaData.commissionAmount || '0'})`,
      `📸 תמונות שנבחרו: ${selectedImages.length}`,
      `📄 תמונות חוזה: ${agreementImages.length}`,
    ].join('\n'),
    instagramLink: '',
    priceIncludesVat: true,
    eventTypes: ['חתונה'],
    videos: [],
    products,
    portfolio,
    reviews: reviewList,
    mainProductId: fiestaData.mainProductId || '',
  };
}

/**
 * Product data and agreement files are owned by the Fiesta admin. An agent
 * re-push that carries no products / no contract file must leave the existing
 * ones alone instead of blanking them.
 */
function withoutBlankProductFields(fields) {
  const next = { ...fields };
  if (!next.products?.length) {
    delete next.products;
    delete next.mainProductId;
  }
  if (!next.agreementImages?.length) {
    delete next.agreementImages;
    if (!String(next.agreementImage || '').trim()) {
      delete next.agreementImage;
    }
  } else {
    next.agreementImage = next.agreementImages[0] || '';
  }
  // A re-push with empty pricing must not wipe prices the admin already set.
  const priceNum = Number(String(next.price ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    delete next.price;
    delete next.originalPrice;
    delete next.discount;
    delete next.discountType;
    delete next.commissionAmount;
    delete next.commissionPercent;
  }
  return next;
}

/**
 * Insert or fully update a vendor from agent push.
 * Agent-selected type / description / gallery always win.
 */
export async function pushSupplierToFiesta({
  vendorsCollection,
  supplier,
  fiestaData,
  origin = '',
  updateIfExists = true,
  db = null,
}) {
  if (!supplier) {
    throw new Error('חסרים נתוני ספק');
  }
  if (!fiestaData?.type && !(Array.isArray(fiestaData?.types) && fiestaData.types.length)) {
    throw new Error('יש לבחור קטגוריה לפני השליחה');
  }

  const fiestaDb = db || dbFromVendorsCollection(vendorsCollection);
  const existing = await findExistingVendor(vendorsCollection, supplier);
  const vendorFields = await buildVendorFields({
    supplier,
    fiestaData,
    origin,
    db: fiestaDb,
  });

  if (existing) {
    if (!updateIfExists) {
      return { status: 'exists', vendorId: existing._id, name: existing.name };
    }

    await vendorsCollection.updateOne(
      { _id: existing._id },
      {
        $set: {
          ...withoutBlankProductFields(vendorFields),
          updatedAt: new Date(),
        },
      }
    );

    return {
      status: 'updated',
      vendorId: existing._id,
      name: vendorFields.name,
    };
  }

  const result = await vendorsCollection.insertOne({
    ...vendorFields,
    createdAt: new Date(),
  });

  return {
    status: 'success',
    vendorId: result.insertedId,
    name: vendorFields.name,
  };
}
