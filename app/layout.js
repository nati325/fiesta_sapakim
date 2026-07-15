import './globals.css';

export const metadata = {
  title: 'Fiesta | דאשבורד ספקים',
  description: 'ניהול ובדיקת ספקים לאירוע המושלם',
}

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;500;600;700;800&family=Heebo:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'Assistant', sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
