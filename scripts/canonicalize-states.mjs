/**
 * One-shot merge of duplicate supplier_states docs.
 * Usage: node scripts/canonicalize-states.mjs
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { canonicalizeSupplierStates } from '../lib/supplierStateMongo.js';

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI.trim();
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const m = env.match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error('MONGODB_URI missing');
  return m[1].trim();
}

const uri = loadUri();
const client = new MongoClient(uri);
await client.connect();
const collection = client.db('fiesta_crm').collection('supplier_states');
const result = await canonicalizeSupplierStates(collection);
console.log(JSON.stringify(result, null, 2));
await client.close();
