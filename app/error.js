'use client';

export default function Error({ reset }) {
  return (
    <main
      dir="rtl"
      style={{
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'Assistant', sans-serif",
        background: '#f3efe6',
        color: '#1a1a1a',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: '0 0 10px' }}>
          משהו נתקע בטעינה
        </h1>
        <p style={{ margin: '0 0 20px', lineHeight: 1.5, color: '#5c5346' }}>
          זה קורה לפעמים אחרי עדכון. רעננו את המסך — בדרך כלל זה מסתדר מיד.
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              reset();
            } catch {
              /* ignore */
            }
            window.location.reload();
          }}
          style={{
            border: 'none',
            borderRadius: 12,
            padding: '12px 22px',
            background: '#8a6d45',
            color: '#fff',
            fontWeight: 800,
            fontSize: '1rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          רענון
        </button>
      </div>
    </main>
  );
}
