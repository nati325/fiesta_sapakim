/**
 * Split newly harvested photographers between Hodaya and Tal via photoOwner.
 *
 * Usage:
 *   node scripts/split-harvest-photo-agents.mjs
 *   node scripts/split-harvest-photo-agents.mjs --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import dns from 'dns';
import { phoneKey } from '../lib/phoneUtils.js';
import { HODAYA_AGENT, TAL_AGENT } from '../lib/agentFeedRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_TAG = 'mit4mit-photographers-2026-08';
const DRY_RUN = process.argv.includes('--dry-run');

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  /* ignore */
}

const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/suppliers_complete.json'), 'utf8'));
const harvested = json
  .filter((s) => s.source_import === SOURCE_TAG)
  .map((s) => ({
    name: s.name || s.clean_name,
    phone: phoneKey(s.real_phone || s.phone),
  }))
  .filter((s) => s.phone)
  .sort((a, b) => a.phone.localeCompare(b.phone));

if (!harvested.length) {
  console.error('No harvested photographers found');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI missing');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const states = client.db('fiesta_crm').collection('supplier_states');

const ownerCounts = await states
  .aggregate([{ $group: { _id: '$photoOwner', n: { $sum: 1 } } }])
  .toArray();
console.log('photoOwner before:', Object.fromEntries(ownerCounts.map((r) => [r._id || '(empty)', r.n])));

const existing = await states
  .find({ phone: { $in: harvested.map((s) => s.phone) } }, { projection: { phone: 1, photoOwner: 1 } })
  .toArray();
const owned = new Map(existing.map((d) => [d.phone, d.photoOwner || '']));

const hodaya = [];
const tal = [];
const skipped = [];

harvested.forEach((s, i) => {
  const current = owned.get(s.phone);
  if (current === TAL_AGENT || current === HODAYA_AGENT) {
    skipped.push({ ...s, owner: current });
    return;
  }
  const agent = i % 2 === 0 ? HODAYA_AGENT : TAL_AGENT;
  (agent === TAL_AGENT ? tal : hodaya).push(s);
});

console.log(`Harvested: ${harvested.length}`);
console.log(`Assign Hodaya: ${hodaya.length}`);
console.log(`Assign Tal: ${tal.length}`);
console.log(`Already owned: ${skipped.length}`);

if (DRY_RUN) {
  console.log('\nSample Hodaya:', hodaya.slice(0, 3).map((s) => `${s.phone} ${s.name}`));
  console.log('Sample Tal:', tal.slice(0, 3).map((s) => `${s.phone} ${s.name}`));
  await client.close();
  process.exit(0);
}

const now = Date.now();
const ops = [];
for (const [agent, list] of [
  [HODAYA_AGENT, hodaya],
  [TAL_AGENT, tal],
]) {
  for (const s of list) {
    ops.push({
      updateOne: {
        filter: { phone: s.phone },
        update: {
          $set: {
            phone: s.phone,
            phoneKey: s.phone,
            photoOwner: agent,
            assignedAgent: agent,
            assignedCategory: 'צילום',
            supplierName: s.name || '',
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
  }
}

if (ops.length) {
  const result = await states.bulkWrite(ops, { ordered: false });
  console.log(
    `Mongo states: upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`
  );
}

const after = await states
  .aggregate([{ $group: { _id: '$photoOwner', n: { $sum: 1 } } }])
  .toArray();
console.log('photoOwner after:', Object.fromEntries(after.map((r) => [r._id || '(empty)', r.n])));

const harvestPhones = harvested.map((s) => s.phone);
const splitAfter = await states
  .find({ phone: { $in: harvestPhones } }, { projection: { photoOwner: 1 } })
  .toArray();
const harvestSplit = { [HODAYA_AGENT]: 0, [TAL_AGENT]: 0, other: 0 };
for (const d of splitAfter) {
  if (d.photoOwner === TAL_AGENT) harvestSplit[TAL_AGENT] += 1;
  else if (d.photoOwner === HODAYA_AGENT) harvestSplit[HODAYA_AGENT] += 1;
  else harvestSplit.other += 1;
}
console.log('New batch split:', harvestSplit);

await client.close();
process.exit(0);
