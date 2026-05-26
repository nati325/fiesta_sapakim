const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app', 'page.js');
let content = fs.readFileSync(filePath, 'utf8');

const startMarker = `{/* Supplier Image from Google */}`;
const endMarker = `{/* Notes Input */}`;

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex);
    
    const NEW_BLOCK = `                       {/* Supplier Image from Google */}
                       {(() => {
                           let realImage = s["Google Image"] || s["Main Image"];
                           if (realImage && !realImage.includes('/') && !realImage.includes('.')) realImage = null;
                           
                           let realRating = s["Google Rating"];
                           let realReviewsCount = s["Reviews Count"];
                           let realReviewsLink = s["Google Reviews Link"];
                           let realWebsite = s["Website"];
                           
                           if (realReviewsLink && !realReviewsLink.includes('http') && !isNaN(parseFloat(realReviewsLink))) {
                               realRating = realReviewsLink;
                               realReviewsCount = s["Google Image"];
                               realReviewsLink = null;
                               realImage = s["Main Image"] && s["Main Image"].includes('.') ? s["Main Image"] : null;
                           }
                           
                           if (realReviewsLink && !realReviewsLink.startsWith('http')) realReviewsLink = null;
                           if (realWebsite && !realWebsite.includes('.')) realWebsite = null;
                           if (realRating && (isNaN(parseFloat(realRating)) || parseFloat(realRating) > 5 || parseFloat(realRating) <= 0)) realRating = null;
                           if (realReviewsCount && isNaN(parseInt(realReviewsCount))) realReviewsCount = null;

                           return (
                             <>
                               {realImage && (
                                 <div style={{ marginBottom: '12px', borderRadius: '10px', overflow: 'hidden', height: '110px', background: '#f1f5f9' }}>
                                   <img
                                     src={realImage}
                                     alt={s["Supplier Name"]}
                                     style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                     onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                                   />
                                 </div>
                               )}
                               <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                                 {realRating && (
                                   <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.8rem', fontWeight: '700' }}>
                                     <span style={{ color: '#f59e0b' }}>{'\u2b50'.repeat(Math.min(5, Math.round(parseFloat(realRating))))}</span>
                                     <span style={{ color: 'var(--text)' }}>{parseFloat(realRating).toFixed(1)}</span>
                                     {realReviewsCount && parseInt(realReviewsCount) > 0 && (
                                       <span style={{ color: 'var(--text-muted)', fontWeight: '500', fontSize: '0.75rem' }}>({parseInt(realReviewsCount)} \u05d1\u05d9\u05e7\u05d5\u05e8\u05d5\u05ea)</span>
                                     )}
                                   </div>
                                 )}
                                 {realReviewsLink && (
                                   <a href={realReviewsLink} target="_blank" rel="noopener noreferrer"
                                     style={{ fontSize: '0.72rem', fontWeight: '700', color: '#4285f4', textDecoration: 'none',
                                       background: '#f0f4ff', padding: '2px 8px', borderRadius: '5px', border: '1px solid #c7d2fe' }}>
                                     \ud83d\udd17 \u05d1\u05d9\u05e7\u05d5\u05e8\u05d5\u05ea \u05d2\u05d5\u05d2\u05dc
                                   </a>
                                 )}
                                 {realWebsite && (
                                   <a href={realWebsite.startsWith('http') ? realWebsite : \`https://\${realWebsite}\`}
                                     target="_blank" rel="noopener noreferrer"
                                     style={{ fontSize: '0.72rem', fontWeight: '700', color: '#10b981', textDecoration: 'none',
                                       background: '#f0fdf4', padding: '2px 8px', borderRadius: '5px', border: '1px solid #bbf7d0' }}>
                                     \ud83c\udf10 \u05d0\u05ea\u05e8
                                   </a>
                                 )}
                               </div>
                             </>
                           );
                       })()}
                     </div>

                     <div>
                       `;
    
    fs.writeFileSync(filePath, before + NEW_BLOCK + after, 'utf8');
    console.log('✅ הבעיה טופלה בהצלחה!');
} else {
    console.log('❌ לא נמצא מקום ההחלפה');
}
