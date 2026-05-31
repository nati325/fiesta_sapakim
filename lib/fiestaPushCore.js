import { pickMainImage, toPortfolioItems } from './fiestaImages.js';
import { extractRegionFromAddress, mapCategoryToFiesta } from './fiestaCategoryMap.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildDefaultFiestaData(supplier, overrides = {}) {
  const address = supplier.Address || supplier.address || '';
  const category = supplier.Category || supplier.category || '';
  const images = overrides.selectedImages || overrides.images || [];

  return {
    type: overrides.type || mapCategoryToFiesta(category),
    description: overrides.description || `${category} באזור ${address}`.trim(),
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
  const supplierPhone = (supplier['Real Phone'] || supplier.phone || '').replace(/\D/g, '');

  if (!supplierName && !supplierPhone) return null;

  const or = [];
  if (supplierName) {
    or.push({ name: { $regex: new RegExp(`^${escapeRegex(supplierName)}$`, 'i') } });
  }
  if (supplierPhone) {
    or.push({ contact: { $regex: supplierPhone } });
  }

  return vendorsCollection.findOne({ $or: or });
}

export async function pushSupplierToFiesta({ vendorsCollection, supplier, fiestaData, origin = '' }) {
  if (!supplier) {
    throw new Error('חסרים נתוני ספק');
  }
  if (!fiestaData?.type) {
    throw new Error('יש לבחור קטגוריה לפני השליחה');
  }

  const existing = await findExistingVendor(vendorsCollection, supplier);
  if (existing) {
    return { status: 'exists', vendorId: existing._id, name: existing.name };
  }

  const supplierName = (supplier['Supplier Name'] || supplier.name || '').trim();
  const selectedImages = fiestaData.selectedImages || fiestaData.images || supplier.images || [];
  const reviewList = fiestaData.reviews || supplier.reviews || [];
  const mainImage =
    (await pickMainImage({ ...supplier, images: selectedImages }, origin)) ||
    (await pickMainImage(supplier, origin));
  const portfolio = await toPortfolioItems(
    selectedImages.length ? selectedImages : supplier.images || [],
    origin
  );

  const vendorDoc = {
    name: supplierName,
    type: fiestaData.type || 'design',
    description: fiestaData.description || supplier.description || '',
    contact: supplier['Real Phone'] || supplier.phone || '',
    image: mainImage,
    region: fiestaData.region || '',
    price: fiestaData.price || '0',
    originalPrice: fiestaData.originalPrice || fiestaData.price || '0',
    discount: fiestaData.discount || '0',
    discountType: fiestaData.discountType || 'percent',
    commissionAmount: Number(fiestaData.commissionAmount) || 0,
    agreementSigned: fiestaData.agreementSigned || false,
    agreementImage: fiestaData.agreementImage || '',
    googleReviewsLink: supplier['Google Reviews Link'] || '',
    googleRating: parseFloat(supplier['Google Rating']) || 5,
    googleReviewsCount: parseInt(supplier['Reviews Count'], 10) || 0,
    adminNotes: [
      `✅ נוסף אוטומטית על ידי סוכן: ${fiestaData.agentName || 'לא ידוע'}`,
      `📍 כתובת: ${supplier.Address || supplier.address || 'אין'}`,
      `🌐 אתר: ${supplier.Website || supplier.website || 'אין'}`,
      `🏷️ קטגוריה מקורית: ${supplier.Category || supplier.category || 'לא צוין'}`,
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
    createdAt: new Date(),
  };

  const result = await vendorsCollection.insertOne(vendorDoc);
  return { status: 'success', vendorId: result.insertedId, name: supplierName };
}
