import { pickMainImage, toPortfolioItems, prepareAgreementImage } from './fiestaImages.js';
import {
  buildDefaultDescription,
  extractRegionFromAddress,
  mapCategoryToFiesta,
} from './fiestaCategoryMap.js';

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
    description,
    region: overrides.region || extractRegionFromAddress(address),
    originalPrice: overrides.originalPrice || '0',
    price: overrides.price || '0',
    discount: overrides.discount || '0',
    discountType: overrides.discountType || 'percent',
    commissionAmount: Number(overrides.commissionAmount) || 0,
    agentCommission: overrides.agentCommission || '0',
    agreementSigned: overrides.agreementSigned ?? true,
    agreementImage: overrides.agreementImage || '',
    selectedImages: images,
    images,
    reviews: overrides.reviews || supplier.reviews || [],
    agentName: overrides.agentName || 'bulk-push',
  };
}

export async function findExistingVendor(vendorsCollection, supplier) {
  const supplierName = (supplier['Supplier Name'] || supplier.name || '').trim();
  const supplierPhone = digitsOnly(supplier['Real Phone'] || supplier.phone || '');

  if (!supplierName && !supplierPhone) return null;

  const or = [];
  if (supplierName) {
    or.push({ name: { $regex: new RegExp(`^${escapeRegex(supplierName)}$`, 'i') } });
  }

  const phonePattern = flexiblePhoneRegex(supplierPhone);
  if (phonePattern) {
    or.push({ contact: { $regex: phonePattern } });
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

async function buildVendorFields({ supplier, fiestaData, origin }) {
  const supplierName = (supplier['Supplier Name'] || supplier.name || '').trim();
  const selectedImages = fiestaData.selectedImages || fiestaData.images || supplier.images || [];
  const reviewList = fiestaData.reviews || supplier.reviews || [];

  const mainImage =
    (await pickMainImage({ ...supplier, images: selectedImages }, origin, selectedImages)) ||
    (await pickMainImage(supplier, origin));

  const portfolio = await toPortfolioItems(
    selectedImages.length ? selectedImages : supplier.images || [],
    origin
  );

  const agreementImage = await prepareAgreementImage(fiestaData.agreementImage || '', origin);

  return {
    name: supplierName,
    type: fiestaData.type || mapCategoryToFiesta(supplier.Category || supplier.category, supplier),
    description:
      fiestaData.description ||
      buildDefaultDescription(supplier) ||
      '',
    contact: supplier['Real Phone'] || supplier.phone || '',
    image: mainImage,
    region: fiestaData.region || '',
    price: String(fiestaData.price ?? '0'),
    originalPrice: String(fiestaData.originalPrice || fiestaData.price || '0'),
    discount: String(fiestaData.discount || '0'),
    discountType: fiestaData.discountType || 'percent',
    commissionAmount: Number(fiestaData.commissionAmount) || 0,
    agreementSigned: Boolean(fiestaData.agreementSigned),
    agreementImage,
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
      `🏷️ קטגוריית אתר: ${fiestaData.type || ''}`,
      `💼 עמלת סוכן: ₪${fiestaData.agentCommission || '0'}`,
      `🏢 עמלת Fiesta: ₪${fiestaData.commissionAmount || '0'}`,
      `📸 תמונות שנבחרו: ${selectedImages.length}`,
    ].join('\n'),
    instagramLink: '',
    priceIncludesVat: true,
    eventTypes: ['חתונה'],
    videos: [],
    products: [],
    portfolio,
    reviews: reviewList,
    mainProductId: '',
  };
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
}) {
  if (!supplier) {
    throw new Error('חסרים נתוני ספק');
  }
  if (!fiestaData?.type) {
    throw new Error('יש לבחור קטגוריה לפני השליחה');
  }

  const existing = await findExistingVendor(vendorsCollection, supplier);
  const vendorFields = await buildVendorFields({ supplier, fiestaData, origin });

  if (existing) {
    if (!updateIfExists) {
      return { status: 'exists', vendorId: existing._id, name: existing.name };
    }

    await vendorsCollection.updateOne(
      { _id: existing._id },
      {
        $set: {
          ...vendorFields,
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
