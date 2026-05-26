/**
 * Script to fix relative URLs in page.js for Google Reviews Links
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app', 'page.js');
let content = fs.readFileSync(filePath, 'utf8');

// Target the Google Reviews Link a tag
const TARGET = `<a href={s["Google Reviews Link"]} target="_blank" rel="noopener noreferrer"`;
const REPLACEMENT = `<a href={s["Google Reviews Link"].startsWith('http') ? s["Google Reviews Link"] : \`https://\${s["Google Reviews Link"]}\`} target="_blank" rel="noopener noreferrer"`;

if (content.includes(TARGET)) {
    content = content.replace(TARGET, REPLACEMENT);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ תוקן הקישור לביקורות גוגל כך שלא יוביל ל-404 במערכת.');
} else {
    console.log('לא נמצאה השורה לתיקון. ייתכן שכבר תוקנה או שהקידוד שונה.');
}
