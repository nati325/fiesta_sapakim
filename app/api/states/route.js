import { NextResponse } from 'next/server';
import getMongoClient from '../../../lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = await getMongoClient();
    const db = client.db('fiesta_crm');
    const collection = db.collection('supplier_states');
    
    const allStatesArray = await collection.find({}).toArray();
    
    const statesObject = {};
    allStatesArray.forEach(doc => {
      const { _id, phone, ...stateData } = doc;
      if (phone) {
        // Don't send huge base64 images in list response — slows dashboard
        if (stateData.uploadedImage && String(stateData.uploadedImage).startsWith('data:')) {
          stateData.uploadedImage = '[stored]';
        }
        statesObject[phone] = stateData;
      }
    });

    return NextResponse.json(statesObject);
  } catch (error) {
    console.error("MongoDB GET Error:", error);
    return NextResponse.json({});
  }
}

export async function POST(req) {
  try {
    const payload = await req.json();
    
    if (payload.phone !== undefined && payload.state) {
      const client = await getMongoClient();
      const db = client.db('fiesta_crm');
      const collection = db.collection('supplier_states');

      const setFields = { phone: payload.phone };
      const unsetFields = {};

      for (const [key, value] of Object.entries(payload.state)) {
        if (key === 'phone') continue;
        if (value === null || value === undefined) {
          unsetFields[key] = '';
        } else {
          setFields[key] = value;
        }
      }

      const update = {};
      if (Object.keys(setFields).length > 1) {
        update.$set = setFields;
      } else if (setFields.phone) {
        update.$set = { phone: payload.phone };
      }
      if (Object.keys(unsetFields).length) {
        update.$unset = unsetFields;
      }

      if (!update.$set && !update.$unset) {
        return NextResponse.json({ success: true });
      }

      await collection.updateOne(
        { phone: payload.phone },
        update,
        { upsert: true }
      );
      
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ success: false, message: "No phone provided" });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
