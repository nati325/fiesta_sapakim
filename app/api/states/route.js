import { NextResponse } from 'next/server';
import clientPromise from '../../../lib/mongodb';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('fiesta_crm');
    const collection = db.collection('supplier_states');
    
    const allStatesArray = await collection.find({}).toArray();
    
    const statesObject = {};
    allStatesArray.forEach(doc => {
      const { _id, phone, ...stateData } = doc;
      if (phone) {
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
      const client = await clientPromise;
      const db = client.db('fiesta_crm');
      const collection = db.collection('supplier_states');
      
      await collection.updateOne(
        { phone: payload.phone },
        { $set: payload.state },
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
