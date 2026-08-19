import dns from 'dns';
import { MongoClient } from 'mongodb';

let client;
let clientPromise;

function cleanMongoUri(raw) {
  let uri = String(raw || '').trim();
  if (
    (uri.startsWith('"') && uri.endsWith('"')) ||
    (uri.startsWith("'") && uri.endsWith("'"))
  ) {
    uri = uri.slice(1, -1).trim();
  }
  return uri;
}

function configureMongoDns(uri) {
  if (!uri?.startsWith('mongodb+srv://')) return;
  if (process.env.MONGODB_USE_PUBLIC_DNS === 'false') return;
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch {
    // ignore
  }
}

export default function getMongoClient() {
  const uri = cleanMongoUri(process.env.MONGODB_URI);
  if (!uri) {
    throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
  }
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error(
      'MONGODB_URI לא תקין — הסר מרכאות מסביב לערך ב-.env.local / Vercel'
    );
  }

  configureMongoDns(uri);

  const options = {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  };

  if (!clientPromise) {
    if (process.env.NODE_ENV === 'development') {
      if (!global._mongoClientPromise) {
        client = new MongoClient(uri, options);
        global._mongoClientPromise = client.connect();
      }
      clientPromise = global._mongoClientPromise;
    } else {
      client = new MongoClient(uri, options);
      clientPromise = client.connect();
    }
  }
  return clientPromise;
}
