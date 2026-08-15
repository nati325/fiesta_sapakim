import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { phoneKey } from '../lib/phoneUtils.js';
import { findSuppliers } from '../lib/suppliersMongo.js';

const GROUPS = {
  makeup: ['מאפר', 'איפור', 'makeup', 'mua'],
  hair: ['עיצוב שיער', 'מסרק', 'תסרוק', 'שיער', 'hair style', 'braids', 'צמות'],
  dresses: ['שמלות כלה', 'שמלת כלה', 'שמלות', 'bridal dress', 'bridal gown', 'gown'],
};

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function searchText(s) {
  return [s.Category, s.category, s['Supplier Name'], s.name, s.clean_name, s.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function yinonGroup(s) {
  const text = searchText(s);
  if (GROUPS.makeup.some((k) => text.includes(k))) return 'מאפרות';
  if (GROUPS.hair.some((k) => text.includes(k))) return 'עיצוב שיער';
  if (GROUPS.dresses.some((k) => text.includes(k))) return 'שמלות כלה';
  return null;
}

function moranTouched(state) {
  if (!state) return false;
  if (state.firstTouchedBy === 'מורן' || state.lastTouchedBy === 'מורן') return true;
  if (state.agent === 'מורן' || state.assignedAgent === 'מורן') return true;
  return Array.isArray(state.activityLog) && state.activityLog.some((e) => e.agent === 'מורן');
}

function yinonTouched(state) {
  if (!state) return false;
  if (state.firstTouchedBy === 'ינון' || state.lastTouchedBy === 'ינון') return true;
  return Array.isArray(state.activityLog) && state.activityLog.some((e) => e.agent === 'ינון');
}

function tabLabel(state) {
  if (!state?.status && !state?.callbackScheduled) return 'נגעו בלי סטטוס';
  if (state.status === 'not-available') return 'לא ענו';
  if (state.status === 'not-signed') return 'עדיין לא חתם';
  if (state.status === 'not-interested') return 'סירבו';
  if (state.status === 'contract') return 'נחתם';
  if (state.callbackScheduled || state.status === 'thinking' || state.status === 'no-answer') return 'לחזור';
  return state.status || 'אחר';
}

loadEnvLocal();

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const states = await client.db('fiesta_crm').collection('supplier_states').find({}).toArray();
const byPhone = new Map();
for (const doc of states) {
  const key = phoneKey(doc.phone);
  if (key) byPhone.set(key, doc);
}

const suppliers = await findSuppliers({ lite: true });
const rows = [];
for (const s of suppliers) {
  const group = yinonGroup(s);
  if (!group) continue;
  const key = phoneKey(s['Real Phone'] || s.phone);
  const state = byPhone.get(key);
  if (!moranTouched(state)) continue;
  if (yinonTouched(state)) continue;
  rows.push({
    name: s['Supplier Name'] || s.clean_name || '',
    phone: s['Real Phone'] || s.phone || '',
    group,
    tab: tabLabel(state),
  });
}

const byGroup = {};
const byTab = {};
for (const row of rows) {
  byGroup[row.group] = (byGroup[row.group] || 0) + 1;
  byTab[row.tab] = (byTab[row.tab] || 0) + 1;
}

console.log(`ספקים של ינון שמורן כבר דיברה איתם, וינון עוד לא נגע: ${rows.length}`);
console.log('לפי תחום:', byGroup);
console.log('לפי סטטוס אחרון של מורן:', byTab);
console.log('--- דוגמאות ---');
rows.slice(0, 25).forEach((r) => {
  console.log(`${r.group} | ${r.tab} | ${r.name} | ${r.phone}`);
});

await client.close();
process.exit(0);
