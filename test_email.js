const nodemailer = require('nodemailer');
const fs = require('fs');

// Read .env.local manually
const envPath = '.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        envVars[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
});

async function main() {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: envVars['EMAIL_USER'],
            pass: envVars['EMAIL_PASS']
        }
    });

    try {
        const info = await transporter.sendMail({
            from: `"Fiesta CRM Test" <${envVars['EMAIL_USER']}>`,
            to: envVars['EMAIL_YINON'],
            subject: "⏰ בדיקת מערכת Fiesta",
            html: "<b>זהו אימייל ניסיון מהמערכת! הכל עובד בהצלחה.</b>"
        });
        console.log("Message sent: %s", info.messageId);
    } catch (err) {
        console.error("Error sending email:", err);
    }
}

main();
