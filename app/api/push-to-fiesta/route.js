import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { pickMainImage, toPortfolioItems } from '../../../lib/fiestaImages';

let fiestaClient = null;

async function getFiestaDb() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) throw new Error('FIESTA_MONGODB_URI לא מוגדר ב-.env.local');

  if (!fiestaClient) {
    fiestaClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    await fiestaClient.connect();
  }
  return fiestaClient.db('fiesta');
}

export async function POST(req) {
  try {
    const { supplier, fiestaData } = await req.json();
    if (!supplier) {
      return NextResponse.json({ error: 'חסרים נתוני ספק' }, { status: 400 });
    }
    if (!fiestaData?.type) {
      return NextResponse.json({ error: 'יש לבחור קטגוריה לפני השליחה' }, { status: 400 });
    }

    const origin = req.headers.get('origin') || '';
    const db = await getFiestaDb();
    const vendors = db.collection('vendors');

    const supplierName = (supplier['Supplier Name'] || '').trim();
    const supplierPhone = (supplier['Real Phone'] || supplier.phone || '').replace(/\D/g, '');

    const existing = await vendors.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${supplierName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        ...(supplierPhone ? [{ contact: { $regex: supplierPhone } }] : []),
      ],
    });

    if (existing) {
      return NextResponse.json({ exists: true });
    }

    const selectedImages = fiestaData.selectedImages || fiestaData.images || supplier.images || [];
    const reviewList = fiestaData.reviews || supplier.reviews || [];
    const mainImage =
      pickMainImage({ ...supplier, images: selectedImages }, origin) ||
      pickMainImage(supplier, origin);

    const portfolio = toPortfolioItems(selectedImages.length ? selectedImages : supplier.images || [], origin);

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
      googleReviewsCount: parseInt(supplier['Reviews Count']) || 0,
      adminNotes: [
        `✅ נוסף אוטומטית על ידי סוכן: ${fiestaData.agentName || 'לא ידוע'}`,
        `📍 כתובת: ${supplier['Address'] || 'אין'}`,
        `🌐 אתר: ${supplier['Website'] || 'אין'}`,
        `🏷️ קטגוריה מקורית: ${supplier['Category'] || 'לא צוין'}`,
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

    await vendors.insertOne(vendorDoc);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push to Fiesta MongoDB error:', error);
    return NextResponse.json({ error: error.message || 'שגיאה בשליחה לפייסטה' }, { status: 500 });
  }
}
