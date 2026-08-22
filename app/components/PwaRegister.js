'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'fiesta_pwa_install_dismissed';

export default function PwaRegister() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let cancelled = false;

    const register = async () => {
      if (!('serviceWorker' in navigator)) return;
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (!cancelled) {
          // Ensure an active SW controls this page (needed for install criteria).
          if (reg.installing) {
            reg.installing.addEventListener('statechange', () => {
              if (reg.installing?.state === 'activated' || reg.active) {
                /* controlled after claim */
              }
            });
          }
        }
      } catch (err) {
        console.warn('[PWA] service worker registration failed:', err);
      }
    };

    register();

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      try {
        if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
      } catch {
        /* ignore */
      }
      setShowBanner(true);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setShowBanner(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      /* ignore */
    }
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  if (!showBanner || !deferredPrompt) return null;

  return (
    <div
      role="dialog"
      aria-label="התקנת אפליקציה"
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        right: '16px',
        zIndex: 12000,
        maxWidth: '420px',
        marginInline: 'auto',
        background: '#1a1a1a',
        color: '#fff',
        borderRadius: '14px',
        padding: '14px 16px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        direction: 'rtl',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <img
          src="/icons/icon-48.png"
          alt=""
          width={40}
          height={40}
          style={{ borderRadius: '10px', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: '0.95rem' }}>
            התקן את Fiesta במסך הבית
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', opacity: 0.8, lineHeight: 1.35 }}>
            ייפתח כמו אפליקציה — בלי שורת כתובת של כרום
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={handleInstall}
          style={{
            flex: 1,
            border: 'none',
            borderRadius: '10px',
            padding: '11px 14px',
            background: '#25d366',
            color: '#fff',
            fontWeight: 800,
            fontSize: '0.9rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          התקן עכשיו
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '10px',
            padding: '11px 14px',
            background: 'transparent',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.85rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          אחר כך
        </button>
      </div>
    </div>
  );
}
