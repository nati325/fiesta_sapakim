import { phoneKey } from './phoneUtils.js';

function isEmptyVal(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function mergeActivityLogs(docs) {
  const logs = [];
  for (const doc of docs) {
    if (Array.isArray(doc.activityLog)) logs.push(...doc.activityLog);
  }
  logs.sort((a, b) => (a?.at || 0) - (b?.at || 0));
  const seen = new Set();
  const out = [];
  for (const entry of logs) {
    if (!entry || typeof entry !== 'object') continue;
    const id = `${entry.at || ''}|${entry.agent || ''}|${entry.action || ''}|${entry.status || ''}|${entry.value || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
  }
  return out.length > 100 ? out.slice(-100) : out;
}

/** Merge duplicate state docs for the same supplier. Non-empty work wins over empty assignment shells. */
export function mergeStateDocs(docs) {
  const sorted = [...docs].sort((a, b) => (a.lastTouchedAt || 0) - (b.lastTouchedAt || 0));
  const merged = {};

  for (const doc of sorted) {
    for (const [key, value] of Object.entries(doc)) {
      if (key === '_id' || key === 'activityLog') continue;
      if (isEmptyVal(value)) continue;
      merged[key] = value;
    }
  }

  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].status) {
      merged.status = sorted[i].status;
      break;
    }
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const notes = String(sorted[i].notes || '').trim();
    if (notes) {
      merged.notes = sorted[i].notes;
      break;
    }
  }

  const newest = sorted[sorted.length - 1];
  if (newest?.lastTouchedAt) merged.lastTouchedAt = newest.lastTouchedAt;
  if (newest?.lastTouchedBy) merged.lastTouchedBy = newest.lastTouchedBy;

  const activityLog = mergeActivityLogs(docs);
  if (activityLog.length) merged.activityLog = activityLog;

  return merged;
}

function groupDocsByPhoneKey(allDocs) {
  const groups = new Map();
  for (const doc of allDocs) {
    const key = phoneKey(doc.phone || doc.phoneKey);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  return groups;
}

export function normalizeStatesObject(allStatesArray) {
  const statesObject = {};
  allStatesArray.forEach((doc) => {
    const { _id, phone, ...stateData } = doc;
    const key = phoneKey(phone || stateData.phoneKey || stateData.phone);
    if (!key) return;
    if (stateData.uploadedImage && String(stateData.uploadedImage).startsWith('data:')) {
      stateData.uploadedImage = '[stored]';
    }
    statesObject[key] = {
      ...(statesObject[key] || {}),
      ...stateData,
      phone: key,
      phoneKey: key,
    };
  });
  return statesObject;
}

export async function canonicalizeSupplierStates(collection) {
  const all = await collection.find({}).toArray();
  const groups = groupDocsByPhoneKey(all);
  const extraIds = [];
  const opsReplaces = [];
  let mergedGroups = 0;

  for (const [key, docs] of groups) {
    const merged = mergeStateDocs(docs);
    merged.phone = key;
    merged.phoneKey = key;
    delete merged._id;

    const keeper = docs.find((d) => phoneKey(d.phone) === key && d.phone === key) || docs[0];
    const extras = docs.filter((d) => String(d._id) !== String(keeper._id));
    const needsRewrite =
      extras.length > 0 || keeper.phone !== key || keeper.phoneKey !== key;

    if (!needsRewrite) continue;
    if (extras.length) mergedGroups += 1;

    extraIds.push(...extras.map((doc) => doc._id));
    opsReplaces.push({
      replaceOne: {
        filter: { _id: keeper._id },
        replacement: merged,
      },
    });
  }

  if (extraIds.length) {
    await collection.deleteMany({ _id: { $in: extraIds } });
  }
  if (opsReplaces.length) {
    await collection.bulkWrite(opsReplaces, { ordered: false });
  }

  try {
    await collection.createIndex({ phone: 1 }, { unique: true, sparse: true });
  } catch (error) {
    console.warn('supplier_states phone unique index:', error.message);
  }

  return {
    scanned: all.length,
    groups: groups.size,
    mergedGroups,
    writes: extraIds.length + opsReplaces.length,
  };
}

export async function upsertSupplierState(collection, rawPhone, setFields = {}, unsetFields = {}) {
  const key = phoneKey(rawPhone);
  if (!key) {
    throw new Error('No phone provided');
  }

  const patch = { ...setFields };
  delete patch._id;
  delete patch.phone;
  patch.phone = key;
  patch.phoneKey = key;

  const matches = await collection
    .find({ $or: [{ phone: key }, { phoneKey: key }, { phone: String(rawPhone || '') }] })
    .toArray();

  const unique = [];
  const seen = new Set();
  for (const doc of matches) {
    const id = String(doc._id);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(doc);
  }

  const update = { $set: patch };
  if (Object.keys(unsetFields).length) update.$unset = unsetFields;

  const write = async (filter, upsert) => {
    try {
      await collection.updateOne(filter, update, { upsert });
    } catch (error) {
      if (error?.code === 11000) {
        await collection.updateOne({ phone: key }, update, { upsert: false });
        return;
      }
      throw error;
    }
  };

  if (unique.length <= 1) {
    await write(unique[0] ? { _id: unique[0]._id } : { phone: key }, true);
    return;
  }

  const merged = mergeStateDocs(unique);
  Object.assign(merged, patch);
  for (const field of Object.keys(unsetFields)) {
    delete merged[field];
  }
  merged.phone = key;
  merged.phoneKey = key;
  delete merged._id;

  const keeper = unique[0];
  await collection.replaceOne({ _id: keeper._id }, merged);
  await collection.deleteMany({
    _id: { $in: unique.slice(1).map((doc) => doc._id) },
  });
}
