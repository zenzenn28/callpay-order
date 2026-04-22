// lib/firebase.js - Firebase REST API helper (tanpa SDK berat)
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'callpay-28a28';
const API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyBLPe_yx28LyefI856Ysxz3YEPnwA0ENFU';
const BASE_URL   = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function fsGet(path) {
  const res = await fetch(`${BASE_URL}/${path}?key=${API_KEY}`);
  if (!res.ok) return null;
  return res.json();
}

async function fsPatch(path, data) {
  const fields = toFirestore(data);
  const keys   = Object.keys(data).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const res    = await fetch(`${BASE_URL}/${path}?${keys}&key=${API_KEY}`, {
    method : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ fields })
  });
  return res.json();
}

async function fsCreate(path, data) {
  const fields = toFirestore(data);
  const res    = await fetch(`${BASE_URL}/${path}?key=${API_KEY}`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ fields })
  });
  return res.json();
}

async function fsSet(path, data) {
  const fields = toFirestore(data);
  const res    = await fetch(`${BASE_URL}/${path}?key=${API_KEY}`, {
    method : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ fields })
  });
  return res.json();
}

async function fsDelete(path) {
  await fetch(`${BASE_URL}/${path}?key=${API_KEY}`, { method: 'DELETE' });
}

async function fsQuery(collection, filters = []) {
  const structuredQuery = {
    from: [{ collectionId: collection }],
    where: filters.length === 1 ? {
      fieldFilter: {
        field: { fieldPath: filters[0].field },
        op: filters[0].op || 'EQUAL',
        value: toFirestoreValue(filters[0].value)
      }
    } : filters.length > 1 ? {
      compositeFilter: {
        op: 'AND',
        filters: filters.map(f => ({
          fieldFilter: {
            field: { fieldPath: f.field },
            op: f.op || 'EQUAL',
            value: toFirestoreValue(f.value)
          }
        }))
      }
    } : undefined
  };
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery }) }
  );
  const data = await res.json();
  return data.map ? data.map(d => d.document ? { id: d.document.name.split('/').pop(), ...fromFirestore(d.document.fields) } : null).filter(Boolean) : [];
}

function toFirestoreValue(val) {
  if (typeof val === 'string')  return { stringValue: val };
  if (typeof val === 'number')  return { integerValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (val === null)             return { nullValue: null };
  return { stringValue: String(val) };
}

function toFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function fromFirestore(fields = {}) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue  !== undefined) obj[k] = v.stringValue;
    else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.doubleValue  !== undefined) obj[k] = v.doubleValue;
    else obj[k] = null;
  }
  return obj;
}

module.exports = { fsGet, fsPatch, fsCreate, fsSet, fsDelete, fsQuery, fromFirestore };
