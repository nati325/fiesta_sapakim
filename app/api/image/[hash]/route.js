import { MongoClient } from 'mongodb';
import { getImage, isInlineContentType } from '../../../../lib/imageStore';

export const dynamic = 'force-dynamic';

const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

let fiestaClient = null;

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

async function getFiestaDb() {
  const uri = cleanMongoUri(process.env.FIESTA_MONGODB_URI);
  if (!uri) throw new Error('FIESTA_MONGODB_URI לא מוגדר');
  if (!fiestaClient) {
    fiestaClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    await fiestaClient.connect();
  }
  return fiestaClient.db('fiesta');
}

/** Serves bytes stored in Fiesta Mongo so CRM previews of /api/image/<hash> work. */
export async function GET(request, { params }) {
  const { hash } = params;
  const etag = `"${hash}"`;

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': IMMUTABLE },
    });
  }

  try {
    const db = await getFiestaDb();
    const file = await getImage(db, hash);
    if (!file) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'public, max-age=60' },
      });
    }

    const disposition = isInlineContentType(file.contentType) ? 'inline' : 'attachment';
    const headers = {
      'Content-Type': file.contentType,
      'Content-Length': String(file.data.length),
      'Cache-Control': IMMUTABLE,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    if (file.fileName) {
      headers['Content-Disposition'] =
        `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
    }
    return new Response(file.data, { status: 200, headers });
  } catch (error) {
    console.error('CRM image serve error:', error);
    return new Response('Error', { status: 500 });
  }
}
