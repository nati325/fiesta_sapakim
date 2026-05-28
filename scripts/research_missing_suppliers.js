const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Read env variables manually
const envPath = path.join(__dirname, '..', '.env.local');
let mongodbUri = "mongodb+srv://netaneldama_db_user:Dama3253%21%3F@cluster0.te8hbsq.mongodb.net/fiesta_crm?retryWrites=true&w=majority";
let envKeys = [];

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
      if (key === 'MONGODB_URI' && val) mongodbUri = val;
      if (key === 'GEMINI_API_KEY' && val) {
        const customKeys = val.split(',').map(k => k.trim()).filter(Boolean);
        envKeys.push(...customKeys);
      }
    }
  });
}

if (envKeys.length === 0) {
  console.error("[❌] Error: No Gemini API keys found in .env.local. Please define GEMINI_API_KEY.");
  process.exit(1);
}

const SERPER_API_KEY = "ae9018b64b8a4a24a1639012bc57ec00d5330e78";
let currentKeyIndex = 0;

// Arguments parsing
const args = process.argv.slice(2);
const limitArgIdx = args.indexOf('--limit');
let limit = limitArgIdx !== -1 ? parseInt(args[limitArgIdx + 1], 10) : 10;
if (isNaN(limit)) limit = 10;

async function callSerper(query) {
  const url = "https://google.serper.dev/search";
  const payload = JSON.stringify({ q: query, gl: "il", hl: "iw" });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: payload
  });
  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status}`);
  }
  return response.json();
}

async function callGemini(prompt) {
  await new Promise(resolve => setTimeout(resolve, 3000)); // Rate limit safety

  for (let attempt = 0; attempt < envKeys.length * 2; attempt++) {
    const key = envKeys[currentKeyIndex % envKeys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      });
      
      if (response.status === 429) {
        currentKeyIndex++;
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return text.trim();
      }
    } catch (error) {
      console.error(`[⚠️] Gemini call failed with key index ${currentKeyIndex % envKeys.length}:`, error.message);
      currentKeyIndex++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("All Gemini API keys failed.");
}

function isProxyNumber(phone) {
  if (!phone) return true;
  // Clean all non-digit characters
  const digits = phone.replace(/[^0-9]/g, '');
  
  // Normalized digits check (if it starts with 972, replace with 0)
  let normalized = digits;
  if (normalized.startsWith('972')) {
    normalized = '0' + normalized.substring(3);
  }
  
  // Mit4Mit / Easywed / WedPlanner commonly use 072... and 073... proxy numbers
  if (normalized.startsWith('072') || normalized.startsWith('073')) {
    return true;
  }
  
  // Specific directory proxy blocks:
  // 03-637-xxxx (mit4mit routing pool)
  // 03-522-xxxx (often used as routing pools)
  if (normalized.startsWith('03637') || normalized.startsWith('03522')) {
    return true;
  }
  
  return false;
}

async function run() {
  console.log(`[🚀] Starting researcher script. Limit: ${limit}`);
  
  // Connect to DB
  console.log('[ℹ️] Connecting to MongoDB...');
  const client = new MongoClient(mongodbUri);
  await client.connect();
  const db = client.db('fiesta_crm');
  const collection = db.collection('suppliers');
  
  // Load local file
  const completeJsonPath = path.join(__dirname, '..', 'data', 'suppliers_complete.json');
  if (!fs.existsSync(completeJsonPath)) {
    console.error(`[❌] Error: suppliers_complete.json not found.`);
    await client.close();
    return;
  }
  
  let localData = JSON.parse(fs.readFileSync(completeJsonPath, 'utf-8'));
  
  // Filter missing ones
  const missing = localData.filter(item => {
    const phone = item.real_phone || item.phone || '';
    return !phone || phone === 'FAILED' || phone === 'N/A';
  });
  
  console.log(`[ℹ️] Found ${missing.length} missing suppliers in local JSON.`);
  
  const toProcess = missing.slice(0, limit);
  console.log(`[ℹ️] Processing top ${toProcess.length} suppliers...`);
  
  for (let i = 0; i < toProcess.length; i++) {
    const s = toProcess[i];
    const name = s.name;
    const category = s.category || '';
    console.log(`\n--------------------------------------------------`);
    console.log(`[${i+1}/${toProcess.length}] Researching: "${name}" (${category})`);
    
    try {
      // 1. Google search via Serper
      const searchData = await callSerper(`${name} ${category} טלפון אתר`);
      if (!searchData || !searchData.organic || searchData.organic.length === 0) {
        console.warn(`  - No search results found.`);
        continue;
      }
      
      const snippets = searchData.organic.slice(0, 8).map(res => {
        return `Title: ${res.title}\nSnippet: ${res.snippet}\nLink: ${res.link}`;
      }).join('\n---\n');
      
      // 2. Query Gemini
      const prompt = `Based on these Google results for "${name}" (Category: "${category}"), extract the business details:
1. phone: MUST be the official business number (05x mobile or local landline, e.g., 03-xxxxxxx, 09-xxxxxxx, etc.).
   - CRITICAL RULE: DO NOT use proxy or directory service numbers starting with 072, 073, or 03-637 (e.g. 03-637-xxxx, 072-xxxxxxx are proxy lines). Look for a direct mobile or landline.
2. website_url: Official website link.
3. rating: Google rating (number).
4. reviews_count: Number of reviews.
5. address: Full physical address.

Organic snippets context:
${snippets}

Return ONLY a JSON object (no markdown, no backticks, no comments) with these fields:
{
  "phone": "...",
  "website_url": "...",
  "rating": 0.0,
  "reviews_count": 0,
  "address": "...",
  "found": true
}
If not found or no valid phone is found, set "found": false.`;

      const resultText = await callGemini(prompt);
      
      // Extract JSON from response
      let cleanJson = resultText;
      const jsonMatch = resultText.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        cleanJson = jsonMatch[1];
      }
      
      const result = JSON.parse(cleanJson);
      
      if (result.found && result.phone && result.phone.replace(/[^0-9]/g, '').length >= 7) {
        const phoneVal = result.phone.trim();
        
        if (isProxyNumber(phoneVal)) {
          console.log(`[⚠️] REJECTED: Extracted phone is a proxy/commission number: ${phoneVal}`);
          // Mark as FAILED so we don't try it again
          localData = localData.map(item => {
            if (item.id === s.id) {
              return {
                ...item,
                real_phone: 'FAILED',
                phone: 'FAILED'
              };
            }
            return item;
          });
        } else {
          console.log(`[✨] SUCCESS: Found Phone: ${phoneVal}, Website: ${result.website_url}, Address: ${result.address}`);
          
          // Update local JSON array
          localData = localData.map(item => {
            if (item.id === s.id) {
              return {
                ...item,
                real_phone: phoneVal,
                phone: phoneVal,
                website: result.website_url || null,
                address: result.address || item.address,
                google_rating: result.rating ? String(result.rating) : 'nan',
                reviews_count: result.reviews_count ? String(result.reviews_count) : 'nan'
              };
            }
            return item;
          });
          
          // Sync to MongoDB
          await collection.updateOne(
            { phone: phoneVal },
            {
              $set: {
                name: s.name,
                phone: phoneVal,
                category: s.category || "",
                engaged_url: s.engaged_url || "",
                main_image: s.images && s.images.length > 0 ? s.images[0] : "",
                gallery: s.images ? s.images.join(",") : "",
                real_phone: phoneVal,
                website: result.website_url || "",
                google_rating: result.rating ? String(result.rating) : "",
                reviews_count: result.reviews_count ? String(result.reviews_count) : "",
                address: result.address || s.address || "",
                description: s.description || "",
                reviews: s.reviews || [],
                images: s.images || []
              }
            },
            { upsert: true }
          );
          console.log(`[💾] Synced to MongoDB (Upserted).`);
        }
        
      } else {
        console.log(`[❌] FAILED: Phone number could not be found.`);
        // Mark as FAILED so we don't waste requests on it again in future runs
        localData = localData.map(item => {
          if (item.id === s.id) {
            return {
              ...item,
              real_phone: 'FAILED',
              phone: 'FAILED'
            };
          }
          return item;
        });
      }
      
      // Save JSON file in each loop iteration so progress is not lost
      fs.writeFileSync(completeJsonPath, JSON.stringify(localData, null, 2), 'utf-8');
      
    } catch (err) {
      console.error(`[❌] Error processing ${name}:`, err.message);
    }
    
    // Friendly wait between suppliers
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  await client.close();
  console.log(`\n[✅] Research batch completed.`);
}

run().catch(console.error);
