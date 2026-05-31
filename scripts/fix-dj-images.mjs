/**
 * fix-dj-images.mjs - v2
 * Updates DJ image URLs in MongoDB using pre-confirmed hardcoded URLs.
 * No HTTP fetching - all URLs were manually verified via browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

// Confirmed real image URLs (verified via browser)
const DJS = [
  {
    phone: '0523300403',
    name: 'ליאור פרץ',
    image: 'https://engaged.co.il/images/stories/deals/1198/images/resize/%D7%9C%D7%99%D7%90%D7%95%D7%A8_%D7%A4%D7%A8%D7%A5_24_large.jpeg',
  },
  {
    phone: '0544850419',
    name: 'שרון כהן',
    image: 'https://mit4mit.s3.amazonaws.com/uploads/biz/103092/big/1.jpg',
  },
  {
    phone: '0524235911',
    name: 'דיגיי משה בי',
    image: 'https://engaged.co.il/images/stories/deals/3264/images/resize/%D7%93%D7%99%D7%92%D7%99%D7%99_%D7%9E%D7%A9%D7%94_%D7%91%D7%99_38_large.jpg',
  },
  {
    phone: '0584474558',
    name: 'אליהו ידגרוב',
    // No public photos found on any site - using professional DJ stock image
    image: 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
  {
    phone: '0507984019',
    name: 'DJ Easy',
    image: 'https://engaged.co.il/images/stories/deals/1468/images/%D7%93%D7%99%D7%92%D7%B3%D7%99_%D7%90%D7%99%D7%96%D7%99.jpg',
  },
  {
    phone: '0523586868',
    name: 'יובל ענבר',
    image: 'https://mit4mit.s3.amazonaws.com/uploads/biz/2953/big/1.jpg',
  },
];

function buildPhoneQuery(digitsOnly) {
  // Build $or query matching both "0521234567" and "052-1234567" formats
  const withDash = digitsOnly.slice(0, 3) + '-' + digitsOnly.slice(3);
  return {
    $or: [
      { contact: digitsOnly },
      { contact: withDash },
      { contact: { $regex: digitsOnly.slice(0, 3) + '.?' + digitsOnly.slice(3) } },
    ],
  };
}

async function main() {
  const uri = process.env.FIESTA_MONGODB_URI;
  if (!uri) {
    console.error('❌ FIESTA_MONGODB_URI missing from .env.local');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const vendors = client.db('fiesta').collection('vendors');

  // First, list all DJs in DB to help debug
  console.log('\n=== All DJ vendors currently in DB ===');
  const allDjs = await vendors.find({ type: 'dj' }).project({ name: 1, contact: 1, image: 1 }).toArray();
  for (const d of allDjs) {
    const hasImg = d.image?.startsWith('http') ? '✅' : '❌';
    console.log(`  ${hasImg} ${d.name} | contact: ${d.contact} | image: ${(d.image || 'none').slice(0, 60)}`);
  }

  console.log('\n=== Updating DJ images ===');

  for (const dj of DJS) {
    console.log(`\n--- ${dj.name} (${dj.phone}) ---`);

    const query = buildPhoneQuery(dj.phone);
    const vendor = await vendors.findOne(query);

    if (!vendor) {
      console.log(`  ❌ Not found in MongoDB (tried: ${dj.phone} and ${dj.phone.slice(0,3)+'-'+dj.phone.slice(3)})`);
      console.log(`  Tip: check the contacts listed above`);
      continue;
    }

    console.log(`  Found: "${vendor.name}" | contact: ${vendor.contact}`);
    console.log(`  Current image: ${(vendor.image || 'none').slice(0, 70)}`);
    console.log(`  New image:     ${dj.image.slice(0, 70)}`);

    // Build update: always set top-level image
    // Only update portfolio.0.image if portfolio exists and has entries
    const updateDoc = { $set: { image: dj.image } };

    if (vendor.portfolio && vendor.portfolio.length > 0) {
      updateDoc.$set['portfolio.0.image'] = dj.image;
    }

    const result = await vendors.updateOne({ _id: vendor._id }, updateDoc);
    console.log(`  ✅ Updated: ${result.modifiedCount} record(s) modified`);
  }

  console.log('\n\n=== FINAL DJ IMAGES IN DATABASE ===');
  const finalDjs = await vendors.find({ type: 'dj' }).project({ name: 1, image: 1 }).toArray();
  for (const d of finalDjs) {
    const hasRealImg = d.image?.startsWith('http') ? '✅' : '❌';
    console.log(`  ${hasRealImg} ${d.name.slice(0, 35).padEnd(35)} → ${(d.image || 'none').slice(0, 65)}`);
  }

  await client.close();
  console.log('\n✅ Done! All DJ images updated.');
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
