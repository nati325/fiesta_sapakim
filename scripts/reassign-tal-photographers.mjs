/**
 * Give Tal half of the photographers Hodaya has not contacted yet,
 * and remove DJs from Tal's pool.
 *
 * Usage:
 *   node scripts/reassign-tal-photographers.mjs
 *   node scripts/reassign-tal-photographers.mjs --apply
 */
import dns from 'dns';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { phoneKey } from '../lib/phoneUtils.js';
import {
  isDjSupplier,
  isPhotographerSupplier,
  isSupplierTouched,
  isValidSupplierRow,
  PHOTO_OWNER_FIELD,
  TAL_AGENT,
} from '../lib/agentFeedRules.js';
import { mongoDocToSupplier } from '../lib/suppliersMongo.js';

dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

const HODAYA = 'הודיה';
const TAL = TAL_AGENT;

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI.trim();
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const m = env.match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error('MONGODB_URI missing');
  let uri = m[1].trim();
  if (
    (uri.startsWith('"') && uri.endsWith('"')) ||
    (uri.startsWith("'") && uri.endsWith("'"))
  ) {
    uri = uri.slice(1, -1).trim();
  }
  return uri;
}

function supplierName(s) {
  return (s['Supplier Name'] || s.clean_name || s.name || '').trim();
}

function supplierPhone(s) {
  return phoneKey(s['Real Phone'] || s.phone || s.real_phone);
}

function hodayaCalled(state = {}, agent = HODAYA) {
  const log = Array.isArray(state.activityLog) ? state.activityLog : [];
  return log.some((entry) => entry?.action === 'call' && (!entry.agent || entry.agent === agent));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = loadUri();
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 12000,
    connectTimeoutMS: 12000,
  });
  await client.connect();
  const db = client.db('fiesta_crm');
  const suppliersCol = db.collection('suppliers');
  const statesCol = db.collection('supplier_states');

  const [supplierDocs, stateDocs] = await Promise.all([
    suppliersCol
      .find(
        {},
        {
          projection: {
            phoneKey: 1,
            id: 1,
            name: 1,
            clean_name: 1,
            real_phone: 1,
            phone: 1,
            category: 1,
            searchText: 1,
          },
        }
      )
      .toArray(),
    statesCol.find({}, { projection: { uploadedImage: 0 } }).toArray(),
  ]);

  const statesMap = {};
  for (const doc of stateDocs) {
    const key = phoneKey(doc.phone || doc.phoneKey);
    if (!key) continue;
    statesMap[key] = { ...(statesMap[key] || {}), ...doc, phone: key };
  }

  const rows = supplierDocs
    .map((doc) => ({
      ...mongoDocToSupplier(doc, { lite: true }),
      searchText: doc.searchText || '',
      description: doc.description || '',
    }))
    .filter(isValidSupplierRow);

  const photographers = rows.filter(isPhotographerSupplier);
  const djs = rows.filter((s) => isDjSupplier(s) && !isPhotographerSupplier(s));

  const photoStats = {
    total: photographers.length,
    touched: 0,
    calledByHodaya: 0,
    alreadyTal: 0,
  };

  const uncontacted = [];
  for (const s of photographers) {
    const key = supplierPhone(s);
    const state = statesMap[key] || {};
    if (state[PHOTO_OWNER_FIELD] === TAL) photoStats.alreadyTal += 1;
    if (hodayaCalled(state)) photoStats.calledByHodaya += 1;
    if (isSupplierTouched(state)) {
      photoStats.touched += 1;
      continue;
    }
    uncontacted.push({
      phone: key,
      name: supplierName(s),
      id: s.id,
      category: s.Category || s.category || '',
      assignedAgent: state.assignedAgent || '',
      photoOwner: state[PHOTO_OWNER_FIELD] || '',
    });
  }

  uncontacted.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'he');
    if (byName) return byName;
    return a.phone.localeCompare(b.phone);
  });

  const alreadyTalPhones = new Set(
    uncontacted.filter((s) => s.photoOwner === TAL).map((s) => s.phone)
  );
  const pool = uncontacted.filter((s) => s.photoOwner !== TAL);
  const takeCount = Math.floor(pool.length / 2);
  const toTal = pool.slice(0, takeCount);
  const stayHodaya = pool.slice(takeCount);

  const talDjs = djs
    .map((s) => {
      const key = supplierPhone(s);
      const state = statesMap[key] || {};
      return {
        phone: key,
        name: supplierName(s),
        assignedAgent: state.assignedAgent || '',
        photoOwner: state[PHOTO_OWNER_FIELD] || '',
        status: state.status || '',
        touched: isSupplierTouched(state),
      };
    })
    .filter((s) => s.assignedAgent === TAL || s.photoOwner === TAL);

  const talAssignedAny = stateDocs.filter((d) => {
    const key = phoneKey(d.phone || d.phoneKey);
    return (d.assignedAgent === TAL || d[PHOTO_OWNER_FIELD] === TAL) && key;
  }).length;

  console.log('\n=== Tal ← half of Hodaya uncontacted photographers ===');
  console.log(`Photographers: ${photoStats.total}`);
  console.log(`Touched (any work): ${photoStats.touched}`);
  console.log(`Called by Hodaya (activity call): ${photoStats.calledByHodaya}`);
  console.log(`Untouched: ${uncontacted.length}`);
  console.log(`Already photoOwner=Tal: ${photoStats.alreadyTal} (untouched subset ${alreadyTalPhones.size})`);
  console.log(`Uncontacted pool to split: ${pool.length}`);
  console.log(`Will assign to Tal: ${toTal.length}`);
  console.log(`Stay with Hodaya (untouched remainder): ${stayHodaya.length}`);
  console.log(`DJ-only suppliers: ${djs.length}`);
  console.log(`Tal DJ assignments to clear: ${talDjs.length}`);
  console.log(`States currently tagged Tal (assignedAgent or photoOwner): ${talAssignedAny}`);

  console.log('\nSample → Tal:');
  for (const p of toTal.slice(0, 12)) {
    console.log(`  • ${p.name} (${p.phone}) [${p.category}]`);
  }
  if (toTal.length > 12) console.log(`  ... +${toTal.length - 12} more`);

  console.log('\nSample stay Hodaya (untouched):');
  for (const p of stayHodaya.slice(0, 8)) {
    console.log(`  • ${p.name} (${p.phone})`);
  }

  if (talDjs.length) {
    console.log('\nTal DJs to unassign:');
    for (const d of talDjs.slice(0, 12)) {
      console.log(`  • ${d.name} (${d.phone}) assigned=${d.assignedAgent || '-'} touched=${d.touched}`);
    }
    if (talDjs.length > 12) console.log(`  ... +${talDjs.length - 12} more`);
  }

  if (!apply) {
    console.log('\nDry-run only. Run with --apply to write Mongo.');
    await client.close();
    return;
  }

  const now = new Date().toISOString();
  const photoOps = toTal.map((p) => ({
    updateOne: {
      filter: { phone: p.phone },
      update: {
        $set: {
          phone: p.phone,
          phoneKey: p.phone,
          [PHOTO_OWNER_FIELD]: TAL,
          assignedAgent: TAL,
          assignedCategory: 'צלמים',
          assignedAt: now,
          supplierName: p.name,
        },
        $unset: { assignedAgentWas: '' },
      },
      upsert: true,
    },
  }));

  const djOps = talDjs.map((d) => ({
    updateOne: {
      filter: { phone: d.phone },
      update: {
        $set: {
          reassignedFrom: TAL,
          reassignedAt: now,
        },
        $unset: {
          assignedAgent: '',
          [PHOTO_OWNER_FIELD]: '',
        },
      },
    },
  }));

  let photoResult = { modifiedCount: 0, upsertedCount: 0 };
  let djResult = { modifiedCount: 0 };
  if (photoOps.length) {
    photoResult = await statesCol.bulkWrite(photoOps, { ordered: false });
  }
  if (djOps.length) {
    djResult = await statesCol.bulkWrite(djOps, { ordered: false });
  }

  const afterTal = await statesCol.countDocuments({ [PHOTO_OWNER_FIELD]: TAL });
  console.log('\nApplied.');
  console.log(`Photographers written: matched=${photoResult.matchedCount || 0} modified=${photoResult.modifiedCount || 0} upserted=${photoResult.upsertedCount || 0}`);
  console.log(`DJs cleared: modified=${djResult.modifiedCount || 0}`);
  console.log(`photoOwner=Tal now: ${afterTal}`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
