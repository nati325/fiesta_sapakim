/**
 * Run this script to patch page.js and add image/rating/reviews display to supplier cards.
 * Usage: cd C:\Users\123\Desktop\scarping_for_fiesta && node patch_page.js
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app', 'page.js');
let content = fs.readFileSync(filePath, 'utf8');

// Target: the address <p> tag in the supplier card
const OLD = `<p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>{s["Address"] || "\u05de\u05d9\u05e7\u05d5\u05dd \u05dc\u05d0 \u05e6\u05d5\u05d9\u05df"}</p>`;

const NEW = `<p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{s["Address"] || "\u05de\u05d9\u05e7\u05d5\u05dd \u05dc\u05d0 \u05e6\u05d5\u05d9\u05df"}</p>

                       {/* Supplier Image from Google */}
                       {(s["Google Image"] || s["Main Image"]) && (
                         <div style={{ marginBottom: '12px', borderRadius: '10px', overflow: 'hidden', height: '110px', background: '#f1f5f9' }}>
                           <img
                             src={s["Google Image"] || s["Main Image"]}
                             alt={s["Supplier Name"]}
                             style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                             onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                           />
                         </div>
                       )}

                       {/* Google Rating + Reviews + Website */}
                       <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                         {s["Google Rating"] && parseFloat(s["Google Rating"]) > 0 && parseFloat(s["Google Rating"]) <= 10 && (
                           <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.8rem', fontWeight: '700' }}>
                             <span style={{ color: '#f59e0b' }}>{'\u2b50'.repeat(Math.min(5, Math.round(parseFloat(s["Google Rating"]))))}</span>
                             <span style={{ color: 'var(--text)' }}>{parseFloat(s["Google Rating"]).toFixed(1)}</span>
                             {s["Reviews Count"] && parseInt(s["Reviews Count"]) > 0 && (
                               <span style={{ color: 'var(--text-muted)', fontWeight: '500', fontSize: '0.75rem' }}>({s["Reviews Count"]} \u05d1\u05d9\u05e7\u05d5\u05e8\u05d5\u05ea)</span>
                             )}
                           </div>
                         )}
                         {s["Google Reviews Link"] && (
                           <a href={s["Google Reviews Link"]} target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: '0.72rem', fontWeight: '700', color: '#4285f4', textDecoration: 'none',
                               background: '#f0f4ff', padding: '2px 8px', borderRadius: '5px', border: '1px solid #c7d2fe' }}>
                             \ud83d\udd17 \u05d1\u05d9\u05e7\u05d5\u05e8\u05d5\u05ea \u05d2\u05d5\u05d2\u05dc
                           </a>
                         )}
                         {s["Website"] && (
                           <a href={s["Website"].startsWith('http') ? s["Website"] : \`https://\${s["Website"]}\`}
                             target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: '0.72rem', fontWeight: '700', color: '#10b981', textDecoration: 'none',
                               background: '#f0fdf4', padding: '2px 8px', borderRadius: '5px', border: '1px solid #bbf7d0' }}>
                             \ud83c\udf10 \u05d0\u05ea\u05e8
                           </a>
                         )}
                       </div>`;

if (content.includes(OLD)) {
  content = content.replace(OLD, NEW);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ הכרטיסים עודכנו בהצלחה! רענן את הדפדפן.');
} else {
  // Try to find the actual text
  const idx = content.indexOf('marginBottom: \'20px\'');
  if (idx !== -1) {
    console.log('Found marginBottom 20px at index:', idx);
    console.log('Context:', JSON.stringify(content.substring(idx - 100, idx + 200)));
  } else {
    console.log('❌ לא נמצא הטקסט. הדפס את הטקסט הסמוך לשורה 1456:');
    const lines = content.split('\n');
    for (let i = 1453; i < 1460; i++) {
      console.log(`Line ${i+1}: ${JSON.stringify(lines[i])}`);
    }
  }
}
