import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

// Dedicated client for Fiesta's MongoDB cluster (separate from CRM cluster)
let fiestaClient = null;

async function getFiestaDb() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) throw new Error('FIESTA_MONGODB_URI לא מוגדר ב-.env.local');

  if (!fiestaClient) {
    fiestaClient = new MongoClient(uri);
    await fiestaClient.connect();
  }
  return fiestaClient.db('fiesta');
}

export async function POST(req) {
  try {
    const { supplier, fiestaData } = await req.json();

    const db = await getFiestaDb();
    const vendors = db.collection('vendors');

    // ── 1. Check if vendor already exists ──────────────────────────────────
    const supplierName = ((supplier['Supplier Name'] || supplier['name']) || '').trim();
    const supplierPhone = ((supplier['Real Phone'] || supplier['real_phone'] || supplier['phone']) || supplier['phone'] || '').replace(/\D/g, '');

    const existing = await vendors.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${supplierName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        ...(supplierPhone ? [{ contact: { $regex: supplierPhone } }] : [])
      ]
    });

    if (existing) {
      return NextResponse.json({ exists: true });
    }

    // ── 2. Build vendor document matching Fiesta's Vendor schema ───────────
    const selectedImages = fiestaData.selectedImages || [];
    
    // Set main image to the first selected image if available, else fall back
    const mainImg = selectedImages.length > 0 
      ? selectedImages[0] 
      : ((supplier['Main Image'] || (supplier['images'] && supplier['images'][0])) || (supplier['Google Image'] || (supplier['images'] && supplier['images'][1])) || '');

    const vendorDoc = {
      name: supplierName,
      type: fiestaData.type || 'design',
      description: fiestaData.description || '',
      contact: (supplier['Real Phone'] || supplier['real_phone'] || supplier['phone']) || supplier['phone'] || '',
      image: mainImg,
      region: fiestaData.region || '',
      price: fiestaData.price || '0',
      originalPrice: fiestaData.originalPrice || fiestaData.price || '0',
      discount: fiestaData.discount || '0',
      discountType: 'percent',
      commissionAmount: Number(fiestaData.commissionAmount) || 0,
      agreementSigned: fiestaData.agreementSigned || false,
      agreementImage: fiestaData.agreementImage || '',
      googleReviewsLink: supplier['Google Reviews Link'] || '',
      googleRating: parseFloat((supplier['Google Rating'] || supplier['google_rating'])) || 5,
      googleReviewsCount: parseInt((supplier['Reviews Count'] || supplier['reviews_count'])) || 0,
      adminNotes: [
        `✅ נוסף אוטומטית על ידי סוכן: ${fiestaData.agentName || 'לא ידוע'}`,
        `📍 כתובת: ${(supplier['Address'] || supplier['address']) || 'אין'}`,
        `🌐 אתר: ${(supplier['Website'] || supplier['website']) || 'אין'}`,
        `🏷️ קטגוריה מקורית: ${(supplier['Category'] || supplier['category']) || 'לא צוין'}`,
        `💼 עמלת סוכן: ₪${fiestaData.agentCommission || '0'}`,
        `🏢 עמלת Fiesta: ₪${fiestaData.commissionAmount || '0'}`,
        `📸 תמונות שנבחרו: ${selectedImages.length}`
      ].join('\n'),
      instagramLink: '',
      priceIncludesVat: true,
      eventTypes: ['חתונה'],
      videos: [],
      products: [],
      portfolio: selectedImages.map(imgUrl => ({
        title: '',
        image: imgUrl,
        price: ''
      })),
      mainProductId: '',
      createdAt: new Date()
    };

    await vendors.insertOne(vendorDoc);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push to Fiesta MongoDB error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

