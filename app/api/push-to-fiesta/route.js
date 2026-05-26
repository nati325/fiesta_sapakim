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
    const supplierName = (supplier['Supplier Name'] || '').trim();
    const supplierPhone = (supplier['Real Phone'] || supplier['phone'] || '').replace(/\D/g, '');

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
    const vendorDoc = {
      name: supplierName,
      type: fiestaData.type || 'design',
      description: fiestaData.description || '',
      contact: supplier['Real Phone'] || supplier['phone'] || '',
      image: supplier['Main Image'] || supplier['Google Image'] || '',
      region: fiestaData.region || '',
      price: fiestaData.price || '0',
      originalPrice: fiestaData.originalPrice || fiestaData.price || '0',
      discount: fiestaData.discount || '0',
      discountType: 'percent',
      commissionAmount: Number(fiestaData.commissionAmount) || 0,
      agreementSigned: fiestaData.agreementSigned || false,
      agreementImage: '',
      googleReviewsLink: supplier['Google Reviews Link'] || '',
      googleRating: parseFloat(supplier['Google Rating']) || 5,
      googleReviewsCount: parseInt(supplier['Reviews Count']) || 0,
      adminNotes: [
        `✅ נוסף אוטומטית על ידי סוכן: ${fiestaData.agentName || 'לא ידוע'}`,
        `📍 כתובת: ${supplier['Address'] || 'אין'}`,
        `🌐 אתר: ${supplier['Website'] || 'אין'}`,
        `🏷️ קטגוריה מקורית: ${supplier['Category'] || 'לא צוין'}`,
        `💼 עמלת סוכן: ₪${fiestaData.agentCommission || '0'}`,
        `🏢 עמלת Fiesta: ₪${fiestaData.commissionAmount || '0'}`
      ].join('\n'),
      instagramLink: '',
      priceIncludesVat: true,
      eventTypes: ['חתונה'],
      videos: [],
      products: [],
      portfolio: [],
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
