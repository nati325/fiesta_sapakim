import { NextResponse } from 'next/server';
import getMongoClient from '../../../lib/mongodb';
import { phoneKey } from '../../../lib/phoneUtils';

export const dynamic = 'force-dynamic';

function normalizeStatesObject(allStatesArray) {
  const statesObject = {};
  allStatesArray.forEach((doc) => {
    const { _id, phone, ...stateData } = doc;
    const key = phoneKey(phone);
    if (!key) return;
    if (stateData.uploadedImage && String(stateData.uploadedImage).startsWith('data:')) {
      stateData.uploadedImage = '[stored]';
    }
    statesObject[key] = {
      ...(statesObject[key] || {}),
      ...stateData,
      phone: phone || stateData.phone,
    };
  });
  return statesObject;
}

export async function GET() {
  try {
    const client = await getMongoClient();
    const db = client.db('fiesta_crm');
    const collection = db.collection('supplier_states');

    const allStatesArray = await collection.find({}).toArray();
    const statesObject = normalizeStatesObject(allStatesArray);

    return NextResponse.json(statesObject, {
      headers: { 'X-States-Count': String(Object.keys(statesObject).length) },
    });
  } catch (error) {
    console.error('MongoDB GET Error:', error);
    return NextResponse.json(
      { error: error.message || 'MongoDB unavailable' },
      {
        status: 503,
        headers: { 'X-States-Error': '1' },
      }
    );
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
