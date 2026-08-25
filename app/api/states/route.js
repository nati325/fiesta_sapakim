import { NextResponse } from 'next/server';
import getMongoClient from '../../../lib/mongodb';
import { phoneKey } from '../../../lib/phoneUtils';
import {
  normalizeStatesObject,
  upsertSupplierState,
} from '../../../lib/supplierStateMongo';
import { invalidateStatesCache } from '../../../lib/agentFeedQuery';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  try {
    const client = await getMongoClient();
    const collection = client.db('fiesta_crm').collection('supplier_states');

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
    const key = phoneKey(payload.phone);

    if (!key || !payload.state) {
      return NextResponse.json({ success: false, message: 'No phone provided' });
    }

    const client = await getMongoClient();
    const collection = client.db('fiesta_crm').collection('supplier_states');

    const setFields = {};
    const unsetFields = {};

    for (const [field, value] of Object.entries(payload.state)) {
      if (field === 'phone' || field === 'phoneKey') continue;
      if (value === null || value === undefined) {
        unsetFields[field] = '';
      } else if (
        field === 'uploadedImage' &&
        typeof value === 'string' &&
        value.startsWith('data:')
      ) {
        return NextResponse.json(
          {
            error:
              'תמונת החוזה גדולה מדי לשמירה ישירה. העלו מחדש דרך האפליקציה (תידחס אוטומטית).',
          },
          { status: 413 }
        );
      } else {
        setFields[field] = value;
      }
    }

    if (!Object.keys(setFields).length && !Object.keys(unsetFields).length) {
      return NextResponse.json({ success: true });
    }

    await upsertSupplierState(collection, key, setFields, unsetFields);
    invalidateStatesCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
