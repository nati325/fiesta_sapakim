const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Read env variables manually since dotenv might not be loaded
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

// Arguments parsing
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const limitArgIdx = args.indexOf('--limit');
let limit = limitArgIdx !== -1 ? parseInt(args[limitArgIdx + 1], 10) : 10;
if (isNaN(limit)) limit = 10;

let currentKeyIndex = 0;

async function callGemini(prompt) {
  // Enforce delay of 3 seconds per API request to stay within free tier limits (15 RPM)
  await new Promise(resolve => setTimeout(resolve, 3000));

  for (let attempt = 0; attempt < envKeys.length * 2; attempt++) {
    const key = envKeys[currentKeyIndex % envKeys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      });
      
      if (response.status === 429) {
        console.warn(`[⚠️] Key ${currentKeyIndex % envKeys.length} rate limited. Rotating key...`);
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
      throw new Error("Invalid response format from Gemini API");
    } catch (error) {
      console.error(`[❌] Gemini call failed with key index ${currentKeyIndex % envKeys.length}:`, error.message);
      currentKeyIndex++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("All Gemini API keys failed or rate-limited.");
}

async function run() {
  console.log(`[🚀] Starting clean-up script. Mode: ${isDryRun ? 'DRY-RUN' : 'LIVE UPDATE'}. Limit: ${limit}. Force Reset: ${isForce}`);
  
  // Connect to DB
  console.log('[ℹ️] Connecting to MongoDB...');
  const client = new MongoClient(mongodbUri);
  await client.connect();
  const db = client.db('fiesta_crm');
  const collection = db.collection('suppliers');
  
  if (isForce) {
    console.log("[ℹ️] --force flag detected. Resetting cleaned_by_gemini flag for all suppliers in MongoDB...");
    if (!isDryRun) {
      await collection.updateMany({}, { $unset: { cleaned_by_gemini: "" } });
      console.log("[✅] Reset completed in MongoDB.");
    }
  }

  // Find suppliers that need cleaning (cleaned_by_gemini !== true)
  const query = { cleaned_by_gemini: { $ne: true } };
  const suppliers = await collection.find(query).limit(limit).toArray();
  
  console.log(`[ℹ️] Found ${suppliers.length} suppliers to process.`);
  
  if (suppliers.length === 0) {
    console.log("[✅] All suppliers are already processed or limit set to 0.");
    await client.close();
    return;
  }
  
  // Load local file to sync updates
  const completeJsonPath = path.join(__dirname, '..', 'data', 'suppliers_complete.json');
  let localData = [];
  if (fs.existsSync(completeJsonPath)) {
    try {
      localData = JSON.parse(fs.readFileSync(completeJsonPath, 'utf-8'));
      console.log(`[ℹ️] Loaded ${localData.length} suppliers from suppliers_complete.json for local sync.`);
      if (isForce && !isDryRun) {
        localData = localData.map(item => {
          delete item.cleaned_by_gemini;
          return item;
        });
        fs.writeFileSync(completeJsonPath, JSON.stringify(localData, null, 2), 'utf-8');
        console.log("[✅] Reset completed in suppliers_complete.json.");
      }
    } catch (jsonErr) {
      console.error(`[⚠️] Error reading suppliers_complete.json:`, jsonErr.message);
    }
  }
  
  for (let i = 0; i < suppliers.length; i++) {
    const s = suppliers[i];
    const phone = s.phone || s.real_phone;
    const name = s.name;
    console.log(`\n--------------------------------------------------`);
    console.log(`[${i+1}/${suppliers.length}] Processing Supplier: "${name}" (Phone: ${phone})`);
    
    let updatedFields = { cleaned_by_gemini: true };
    
    // 1. Process description
    if (s.description && s.description.trim()) {
      console.log(`[📝] Original description: "${s.description.substring(0, 120)}..."`);
      const prompt = `שפר ונסח מחדש את תיאור העסק הבא בעברית עבור אתר ספקים לאירועים.
הנחיות חשובות:
- התשובה חייבת להיות בעברית תקנית בלבד. אם התיאור המקורי באנגלית או שפה אחרת, תרגם אותו לעברית מלאה ורהוטה.
- אל תשתמש בשום פנים ואופן בכוכביות (כמו ** או *) או בכל עיצוב מארקדאון (Markdown). החזר טקסט נקי לחלוטין.
- התיאור צריך להיות עשיר, שיווקי ומקצועי. אל תעשה אותו קצר מדי - דאג שהוא יהיה באורך של 3 עד 5 משפטים (בין 40 ל-80 מילים), כדי שיראה מכובד ורציני.
- הסר סוגריים מרובעים כגון [ ] או שלוש נקודות בסוף, תקן שגיאות כתיב ודקדוק וסדר את הפיסוק.
- אל תמציא פרטים לא נכונים על העסק, אלא השתמש במידע הקיים ונסח אותו מחדש בצורה יוקרתית.
- החזר אך ורק את התיאור המשופר ללא שום הקדמה, סימונים, או הערות.

התיאור לעריכה:
${s.description}`;

      try {
        let cleanedDesc = await callGemini(prompt);
        // Clean any markdown formatting like bold asterisks
        cleanedDesc = cleanedDesc.replace(/\*/g, '').replace(/[\r\n]+/g, ' ').trim();
        console.log(`[✨] Cleaned description: "${cleanedDesc}"`);
        updatedFields.description = cleanedDesc;
      } catch (err) {
        console.error(`[❌] Failed to clean description:`, err.message);
      }
    } else {
      // If there is no description, generate a minimal placeholder based on category
      const category = s.category || "אירועים";
      console.log(`[📝] No description found. Generating description for category "${category}"...`);
      const prompt = `צור תיאור עסק מקצועי, משכנע ושיווקי בעברית עבור ספק אירועים בשם "${name}" בקטגוריה "${category}".
הנחיות:
- התשובה חייבת להיות בעברית בלבד. ללא אנגלית.
- אל תשתמש בכוכביות (**) או בעיצוב מארקדאון (Markdown). החזר טקסט נקי בלבד.
- התיאור צריך להיות באורך של 3 עד 4 משפטים מקיפים ומכובדים (כ-40-60 מילים) שמתארים את השירות המקצועי, האיכות והיחס האישי של הספק.
- אל תוסיף הקדמות כמו "הנה התיאור:" אלא החזר רק את הטקסט עצמו.`;
      try {
        let generatedDesc = await callGemini(prompt);
        generatedDesc = generatedDesc.replace(/\*/g, '').replace(/[\r\n]+/g, ' ').trim();
        console.log(`[✨] Generated description: "${generatedDesc}"`);
        updatedFields.description = generatedDesc;
      } catch (err) {
        console.error(`[❌] Failed to generate description:`, err.message);
      }
    }
    
    // 2. Process reviews
    if (s.reviews && s.reviews.length > 0) {
      console.log(`[💬] Processing ${s.reviews.length} reviews...`);
      const cleanedReviews = [];
      
      for (let rIdx = 0; rIdx < s.reviews.length; rIdx++) {
        const r = s.reviews[rIdx];
        if (r.text && r.text.trim()) {
          const rPrompt = `נקה, שפר ונסח מחדש את חוות הדעת הבאה של לקוח על עסק.
הנחיות:
- התשובה חייבת להיות בעברית בלבד. אם חוות הדעת המקורית נכתבה באנגלית או שפה אחרת, תרגם אותה לעברית.
- אל תשתמש בשום פנים ואופן בכוכביות (**) או בעיצוב מארקדאון (Markdown). החזר טקסט נקי.
- אם חוות הדעת מכילה רק קידום מכירות עצמי, פרסומות, טקסט גנרי של אתרים (כמו "mit4mit חוות דעת", "השאירו פרטים"), או שהיא בלתי מובנת לחלוטין - החזר בדיוק מחרוזת ריקה "" כדי להשמיט אותה.
- נסח מחדש כך שישמע כחוות דעת טבעית, חיובית ומנוסחת היטב של לקוח אמיתי (כ-2-3 משפטים ברורים).
- החזר אך ורק את חוות הדעת הנקייה ללא שום הקדמה או הערות.

חוות הדעת לניקוי:
${r.text}`;

          try {
            let cleanedText = await callGemini(rPrompt);
            cleanedText = cleanedText.replace(/\*/g, '').trim();
            if (cleanedText && cleanedText.replace(/['"']/g, '').trim() !== "") {
              cleanedReviews.push({
                ...r,
                text: cleanedText
              });
              console.log(`  - Review ${rIdx+1}: Cleaned successfully.`);
            } else {
              console.log(`  - Review ${rIdx+1}: Omitted (classified as spam/metadata).`);
            }
          } catch (err) {
            console.error(`  - Review ${rIdx+1}: Failed to clean, keeping original.`, err.message);
            cleanedReviews.push(r);
          }
        } else {
          cleanedReviews.push(r);
        }
      }
      updatedFields.reviews = cleanedReviews;
    }
    
    // 3. Save updates
    if (!isDryRun) {
      // A. Update MongoDB
      try {
        await collection.updateOne({ phone: phone }, { $set: updatedFields });
        console.log(`[💾] Updated in MongoDB.`);
      } catch (dbErr) {
        console.error(`[❌] Failed to write to MongoDB:`, dbErr.message);
      }
      
      // B. Update suppliers_complete.json
      if (localData.length > 0) {
        let localUpdated = false;
        localData = localData.map(item => {
          const itemPhone = item.real_phone || item.phone || "";
          if (itemPhone === phone) {
            localUpdated = true;
            return {
              ...item,
              description: updatedFields.description !== undefined ? updatedFields.description : item.description,
              reviews: updatedFields.reviews !== undefined ? updatedFields.reviews : item.reviews,
              cleaned_by_gemini: true
            };
          }
          return item;
        });
        
        if (localUpdated) {
          try {
            fs.writeFileSync(completeJsonPath, JSON.stringify(localData, null, 2), 'utf-8');
            console.log(`[💾] Updated in suppliers_complete.json.`);
          } catch (fsErr) {
            console.error(`[❌] Failed to write to suppliers_complete.json:`, fsErr.message);
          }
        }
      }
      
      // C. Update data/supplier_descriptions.json if description is updated
      if (updatedFields.description !== undefined) {
        const descPath = path.join(__dirname, '..', 'data', 'supplier_descriptions.json');
        if (fs.existsSync(descPath)) {
          try {
            const descContent = fs.readFileSync(descPath, 'utf-8');
            const descData = JSON.parse(descContent);
            descData[name] = {
              description: updatedFields.description,
              source: "gemini_cleaned",
              last_updated: new Date().toISOString().replace('T', ' ').substring(0, 19)
            };
            fs.writeFileSync(descPath, JSON.stringify(descData, null, 2), 'utf-8');
            console.log(`[💾] Updated in supplier_descriptions.json.`);
          } catch (descErr) {
            console.error(`[❌] Failed to write to supplier_descriptions.json:`, descErr.message);
          }
        }
      }
    } else {
      console.log(`[🔍] Dry run: No changes saved.`);
    }
    
    // Rate limit friendly sleep
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  await client.close();
  console.log(`\n[✅] Processing completed for batch.`);
}

run().catch(console.error);
