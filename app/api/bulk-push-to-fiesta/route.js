import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { loadSuppliersFromJson, normalizeSupplierRecord } from '../../../lib/supplierEnrichment';
import {
  buildDefaultFiestaData,
  findExistingVendor,
  pushSupplierToFiesta,
} from '../../../lib/fiestaPushCore';
import { collectSupplierImages } from '../../../lib/fiestaCategoryMap';

export const dynamic = 'force-dynamic';

let fiestaClient = null;
let crmClient = null;

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

async function getCrmDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI לא מוגדר ב-.env.local');

  if (!crmClient) {
    crmClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    await crmClient.connect();
  }
  return crmClient.db('fiesta_crm');
}

function phoneKey(value) {
  return String(value || '').replace(/\D/g, '');
}

function indexSuppliers(list) {
  const byPhone = new Map();
  for (const raw of list) {
    const supplier = normalizeSupplierRecord(raw);
    const key = phoneKey(supplier['Real Phone'] || supplier.phone);
    if (key) byPhone.set(key, supplier);
  }
  return byPhone;
}

export async function GET() {
  try {
    const { list } = loadSuppliersFromJson();
    const byPhone = indexSuppliers(list);
    const crmDb = await getCrmDb();
    const fiestaDb = await getFiestaDb();
    const vendors = fiestaDb.collection('vendors');

    const contractStates = await crmDb
      .collection('supplier_states')
      .find({ status: 'contract' })
      .toArray();

    const pending = [];
    for (const state of contractStates) {
      const key = phoneKey(state.phone);
      const supplier = byPhone.get(key);
      if (!supplier) continue;
      const existing = await findExistingVendor(vendors, supplier);
      if (!existing) {
        pending.push({
          phone: supplier['Real Phone'] || supplier.phone,
          name: supplier['Supplier Name'],
          category: supplier.Category,
          agent: state.agent || '',
        });
      }
    }

    return NextResponse.json({ count: pending.length, pending });
  } catch (error) {
    console.error('pending-fiesta GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { phones = [], pushAllContract = false, agentName = 'bulk-push' } = body || {};

    const { list } = loadSuppliersFromJson();
    const byPhone = indexSuppliers(list);
    const fiestaDb = await getFiestaDb();
    const vendors = fiestaDb.collection('vendors');
    const origin = req.headers.get('origin') || '';

    let targets = [];

    if (pushAllContract) {
      const crmDb = await getCrmDb();
      const contractStates = await crmDb
        .collection('supplier_states')
        .find({ status: 'contract' })
        .toArray();
      targets = contractStates
        .map((state) => byPhone.get(phoneKey(state.phone)))
        .filter(Boolean);
    } else if (Array.isArray(phones) && phones.length > 0) {
      targets = phones.map((phone) => byPhone.get(phoneKey(phone))).filter(Boolean);
    } else {
      return NextResponse.json(
        { error: 'שלח phones[] או pushAllContract: true' },
        { status: 400 }
      );
    }

    const results = [];
    for (const supplier of targets) {
      const images = collectSupplierImages(supplier);
      const fiestaData = buildDefaultFiestaData(supplier, {
        selectedImages: images,
        images,
        agentName,
        agreementSigned: true,
        ...(body.overrides || {}),
      });

      try {
        const result = await pushSupplierToFiesta({
          vendorsCollection: vendors,
          supplier,
          fiestaData,
          origin,
        });
        results.push({
          name: supplier['Supplier Name'],
          phone: supplier['Real Phone'] || supplier.phone,
          ...result,
        });
      } catch (error) {
        results.push({
          name: supplier['Supplier Name'],
          phone: supplier['Real Phone'] || supplier.phone,
          status: 'error',
          error: error.message,
        });
      }
    }

    const summary = {
      requested: targets.length,
      success: results.filter((r) => r.status === 'success').length,
      exists: results.filter((r) => r.status === 'exists').length,
      errors: results.filter((r) => r.status === 'error').length,
      results,
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('bulk-push POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
