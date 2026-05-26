const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app', 'page.js');
const content = fs.readFileSync(filePath, 'utf8');

// Find the section that renders the links
const idx = content.indexOf('Google Reviews Link');
if (idx !== -1) {
    console.log(content.substring(idx - 200, idx + 500));
} else {
    console.log('Not found');
}
