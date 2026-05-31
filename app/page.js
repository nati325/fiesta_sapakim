'use client';
import { useEffect, useState } from 'react';
import { Upload, MessageCircle, Phone, Calendar, CheckCircle2, ChevronDown, User, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supplierMatchesSearch } from '../lib/searchUtils';
import './globals.css';

export default function SuppliersDashboard() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [supplierStates, setSupplierStates] = useState({});
  const [activeAgent, setActiveAgent] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [activeCallbackPicker, setActiveCallbackPicker] = useState(null);
  const [callbackAlerts, setCallbackAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState('לטיפול');
  const [showReminderSuccess, setShowReminderSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupplierProfile, setSelectedSupplierProfile] = useState(null);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescriptionText, setEditedDescriptionText] = useState('');
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [apiHealthWarning, setApiHealthWarning] = useState(null);
  const [supplierImages, setSupplierImages] = useState({}); // phone → imageUrl | 'loading' | 'error'
  const [fetchingAllImages, setFetchingAllImages] = useState(false);
  const [imageFetchProgress, setImageFetchProgress] = useState({ done: 0, total: 0 });

  // ── Fiesta Push Modal ────────────────────────────────────────────────────────
  const [showFiestaPushModal, setShowFiestaPushModal] = useState(false);
  const [fiestaPushSupplier, setFiestaPushSupplier] = useState(null);
  const [fiestaPushLoading, setFiestaPushLoading] = useState(false);
  const [fiestaPushResult, setFiestaPushResult] = useState(null); // 'success' | 'exists' | 'error'
  const [fiestaPushError, setFiestaPushError] = useState('');
  const [fiestaPushStep, setFiestaPushStep] = useState(1);
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [fiestaPushForm, setFiestaPushForm] = useState({
    type: '',
    description: '',
    region: '',
    originalPrice: '',    // מחיר מחירון (מה שהספק לוקח בשוק)
    price: '',            // מחיר ללקוח דרך Fiesta (אחרי הנחה)
    agentCommission: '',  // עמלת הסוכן
    commissionAmount: '', // עמלת Fiesta
    discountDisplayType: 'percent', // 'percent' | 'amount'
    agreementSigned: false
  });

  // All Fiesta categories — exact slugs from categoryData in /category/[type]/page.jsx
  const FIESTA_CATEGORIES = [
    { value: 'venue',             label: 'אולמות וגנים',       emoji: '🏛️' },
    { value: 'dj',                label: 'DJ ומוזיקה',          emoji: '🎵' },
    { value: 'photographer',      label: 'צילום אירועים',       emoji: '📸' },
    { value: 'design',            label: 'עיצוב אירועים',       emoji: '🌸' },
    { value: 'catering',          label: 'קייטרינג',            emoji: '🍽️' },
    { value: 'makeup',            label: 'איפור',               emoji: '💄' },
    { value: 'dresses',           label: 'שמלות כלה',           emoji: '👗' },
    { value: 'suits',             label: 'חליפות חתן',          emoji: '👔' },
    { value: 'hair',              label: 'עיצוב שיער',          emoji: '💇' },
    { value: 'bar',               label: 'שירותי בר',           emoji: '🍹' },
    { value: 'alcohol',           label: 'אלכוהול ובר',         emoji: '🥂' },
    { value: 'rings',             label: 'טבעות נישואין',       emoji: '💍' },
    { value: 'transportation',    label: 'הסעות',               emoji: '🚌' },
    { value: 'cars',              label: 'רכבי יוקרה',          emoji: '🚗' },
    { value: 'singers',           label: 'זמרים ולהקות',        emoji: '🎤' },
    { value: 'attractions',       label: 'אטרקציות',            emoji: '🎪' },
    { value: 'event-production',  label: 'הפקת אירועים',        emoji: '🎭' },
    { value: 'invitations',       label: 'הזמנות',              emoji: '💌' },
    { value: 'rabbi',             label: 'רב לחופה',            emoji: '✡️' },
    { value: 'cantors',           label: 'חזנים ופייטנים',      emoji: '🎶' },
    { value: 'religious-bands',   label: 'להקות דתיות',         emoji: '🎸' },
    { value: 'challa',            label: 'הפרשת חלה',           emoji: '🍞' },
    { value: 'hotels',            label: 'מלונות',              emoji: '🏨' },
    { value: 'getting-ready',     label: 'התארגנות כלה',        emoji: '👰' },
    { value: 'bachelor',          label: 'מסיבות רווקים',       emoji: '🎉' },
    { value: 'souvenirs',         label: 'מזכרות',              emoji: '🎁' },
    { value: 'bride-shoes',       label: 'נעלי כלה',            emoji: '👠' },
    { value: 'groom-shoes',       label: 'נעלי חתן',            emoji: '👞' },
    { value: 'equipment-rental',  label: 'השכרת ציוד',          emoji: '🔧' },
    { value: 'rsvp',              label: 'אישורי הגעה',         emoji: '✉️' },
    { value: 'dietitians',        label: 'תזונה ודיאטה',        emoji: '🥗' },
    { value: 'personal-training', label: 'כושר ואימון',         emoji: '💪' },
  ];
  
  // Categories mapping
  const agentCategoryMap = {
    'ינון': ['מוזיקה', 'די ג\'יי', 'DJ', 'דיג\'יי', 'תקליטן'],
    'מורן': ['אולמות וגנים', 'גני אירועים', 'אולמות אירועים', 'מאפרות', 'שיער', 'כלות', 'לחתן ולכלה'],
    'הודיה': ['מאפרות', 'שיער', 'כלות', 'לחתן ולכלה'],
    'נתנאל': [] // Sees all
  };

  useEffect(() => {
    fetch('/api/suppliers', { cache: 'no-store' })
      .then(async (res) => {
        const source = res.headers.get('X-Suppliers-Source');
        const data = await res.json();

        if (!Array.isArray(data)) {
          console.error('Suppliers API returned invalid data:', data);
          setApiHealthWarning('שגיאה בטעינת ספקים מהשרת. סגור את השרת והרץ מחדש: restart-dashboard.bat');
          setLoading(false);
          return;
        }

        const emptyInPayload = data.filter((s) => {
          const name = (s['Supplier Name'] || s.name || s.clean_name || '').trim();
          return !name || name === 'ספק ללא שם';
        }).length;

        if (source !== 'json' || data.length > 850 || emptyInPayload > 5) {
          setApiHealthWarning(
            `השרת מריץ גרסה ישנה (${data.length} רשומות, ${emptyInPayload} ללא שם). סגור את החלון של npm run dev והרץ: restart-dashboard.bat — או בטרמינל: npm run dev:fresh`
          );
        } else {
          setApiHealthWarning(null);
        }

        const normalizeRow = (s) => {
          const category = s.Category || s.category || '';
          const supplierName = (s['Supplier Name'] || s.name || s.Name || s.clean_name || '').trim();
          const cleanName = (s.clean_name || supplierName.split('|')[0]?.trim() || supplierName).trim();
          return {
            ...s,
            id: s.id ?? null,
            clean_name: cleanName,
            'Supplier Name': supplierName || cleanName || 'ספק ללא שם',
            'Real Phone': s['Real Phone'] || s.real_phone || s.phone || s['Phone Number'] || '',
            Category: category.trim() !== '' ? category : 'ספקים ללא קטגוריה',
            Address: s.Address || s.address || '',
            Website: s.Website || s.website || '',
            URL: s.URL || s.engaged_url || '',
            engaged_url: s.engaged_url || s.URL || '',
            description: s.description || '',
            images: s.images || [],
            reviews: s.reviews || [],
          };
        };

        const processedData = data
          .map(normalizeRow)
          .filter((s) => s['Supplier Name'] && s['Supplier Name'] !== 'ספק ללא שם' && (s['Real Phone'] || s.phone));
        setSuppliers(processedData);
        const today = new Date().toISOString().split('T')[0];
        const initialStates = {};
        processedData.forEach((s) => {
          const phone = s["Real Phone"] || s["phone"];
          initialStates[phone] = {
            uploadedImage: null,
            closingDate: today,
            showDatePicker: false,
            status: null,
            reminder: null,
            agent: null
          };
        });
        
        // Fetch saved states
        fetch('/api/states', { cache: 'no-store' })
          .then(res => res.json())
          .then(savedStates => {
            const mergedStates = { ...initialStates };
            for (const key in savedStates) {
              if (mergedStates[key]) {
                mergedStates[key] = { ...mergedStates[key], ...savedStates[key] };
              }
            }
            setSupplierStates(mergedStates);
            setLoading(false);
          })
          .catch(() => {
            setSupplierStates(initialStates);
            setLoading(false);
          });
      })
      .catch(err => {
        console.error(err);
        setApiHealthWarning('לא ניתן להתחבר לשרת. ודא ש-npm run dev רץ על פורט 3000.');
        setLoading(false);
      });
  }, []);

  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const heroMedia = [
    { type: 'video', src: '/media/media_fiesta/WhatsApp%20Video%202026-05-15%20at%2013.37.47.mp4' },
    { type: 'image', src: '/media/media_fiesta/WhatsApp%20Image%202026-05-15%20at%2013.37.18.jpeg' },
    { type: 'video', src: '/media/media_fiesta/WhatsApp%20Video%202026-05-15%20at%2013.37.54.mp4' },
    { type: 'image', src: '/media/media_fiesta/WhatsApp%20Image%202026-05-15%20at%2013.37.25.jpeg' },
    { type: 'image', src: '/media/media_fiesta/WhatsApp%20Image%202026-05-15%20at%2013.37.29.jpeg' },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMediaIndex((prev) => (prev + 1) % heroMedia.length);
    }, 5000); // Change media every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Persistent callback reminder checker running every 5 seconds
  useEffect(() => {
    if (!isLoggedIn || !activeAgent) return;

    const checkReminders = () => {
      const now = Date.now();
      const newAlerts = [];
      const allowedCategories = agentCategoryMap[activeAgent] || [];

      suppliers.forEach((s, index) => {
        const phone = s["Real Phone"] || s["phone"];
        const state = supplierStates[phone];
        if (!state) return;

        // Condition for active, non-dismissed callback reminder
        if (state.callbackTimestamp && now >= state.callbackTimestamp && state.callbackDismissed !== true) {
          
          // Check if this supplier belongs to the active agent
          let isAllowed = false;
          if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') {
            isAllowed = true;
          } else {
            if (s.Category === "ספקים ללא קטגוריה" || !s.Category) {
              isAllowed = true;
            } else {
              const matches = allowedCategories.some(cat => s.Category.includes(cat));
              if (matches) {
                // Split logic for bride categories shared between Moran and Hodaya
                const brideCategories = ['מאפרות', 'שיער', 'כלות', 'לחתן ולכלה'];
                const isBrideCategory = brideCategories.some(cat => s.Category.includes(cat));
                if (isBrideCategory) {
                  if (activeAgent === 'מורן' && index % 2 === 0) isAllowed = true;
                  if (activeAgent === 'הודיה' && index % 2 === 1) isAllowed = true;
                } else {
                  isAllowed = true;
                }
              }
            }
          }

          if (isAllowed) {
            newAlerts.push({
              id: phone,
              supplierName: s["Supplier Name"],
              phone: s["Real Phone"] || s["phone"],
              phoneKey: phone,
              scheduledTime: state.callbackScheduled || 'הזמן שנבחר'
            });

            // Send email and browser push notification if not already sent
            if (!state.callbackEmailSent) {
              // Immediately update DB to prevent multiple triggers
              updateSupplierState(phone, { callbackEmailSent: true });

              // Send browser push notification
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(`⏰ תזכורת - ${s['Supplier Name']}`, {
                  body: `הגיע הזמן לחזור לספק!\nטלפון: ${s['Real Phone']}`,
                  requireInteraction: true
                });
              }

              // Send email alert via existing send-email API
              fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  supplierName: s['Supplier Name'],
                  phone: s['Real Phone'],
                  agentName: activeAgent,
                  scheduledTime: state.callbackScheduled || 'הזמן שנבחר'
                })
              }).catch(console.error);
            }
          }
        }
      });

      // Update callbackAlerts state only if the list has changed
      setCallbackAlerts(prev => {
        const prevKeys = prev.map(a => a.phoneKey).sort().join(',');
        const newKeys = newAlerts.map(a => a.phoneKey).sort().join(',');
        if (prevKeys !== newKeys) {
          return newAlerts;
        }
        return prev;
      });
    };

    checkReminders();
    const timer = setInterval(checkReminders, 5000);
    return () => clearInterval(timer);
  }, [suppliers, supplierStates, activeAgent, isLoggedIn]);

  // ── Category Mapping: CSV → exact Fiesta slugs ────────────────────────────
  // ── Supplier Images ───────────────────────────────────────────────────────
  const getEngagedUrl = (supplier) =>
    supplier?.URL || supplier?.url || supplier?.engaged_url || '';

  const supplierHasHttpImage = (supplier) => {
    if (!supplier) return false;
    if ((supplier.images || []).some((i) => String(i).startsWith('http'))) return true;
    if (supplier['Google Image'] && String(supplier['Google Image']).startsWith('http')) return true;
    if (supplier['Main Image'] && String(supplier['Main Image']).startsWith('http')) return true;
    return false;
  };

  const applyImageToSupplier = (phone, imageUrl) => {
    if (!phone || !imageUrl) return;
    setSupplierImages((prev) => ({ ...prev, [phone]: imageUrl }));
    setSuppliers((prev) =>
      prev.map((s) => {
        const p = s['Real Phone'] || s.phone || '';
        if (p !== phone) return s;
        const rest = (s.images || []).filter((img) => !String(img).startsWith('http'));
        return {
          ...s,
          images: [imageUrl, ...rest],
          'Main Image': imageUrl,
        };
      })
    );
  };

  const getSupplierImage = (supplier) => {
    if (!supplier) return null;
    const phone = supplier['Real Phone'] || supplier.phone || '';
    const cached = phone ? supplierImages[phone] : null;
    if (cached && cached !== 'loading' && cached !== 'error') return cached;
    if (supplier.images?.length) {
      const httpImage = supplier.images.find((item) => item && String(item).startsWith('http'));
      if (httpImage) return httpImage;
    }
    if (supplier['Main Image'] && String(supplier['Main Image']).startsWith('http')) return supplier['Main Image'];
    if (supplier['Google Image'] && String(supplier['Google Image']).startsWith('http')) return supplier['Google Image'];
    return null;
  };

  const fetchImageForSupplier = async (supplier) => {
    const phone = supplier['Real Phone'] || supplier.phone || '';
    const engagedUrl = getEngagedUrl(supplier);
    if (!phone || !engagedUrl) return null;
    if (supplierImages[phone] && supplierImages[phone] !== 'error') return supplierImages[phone];

    setSupplierImages((prev) => ({ ...prev, [phone]: 'loading' }));
    try {
      const res = await fetch(
        `/api/fetch-supplier-image?url=${encodeURIComponent(engagedUrl)}&phone=${encodeURIComponent(phone)}`
      );
      const data = await res.json();
      const imageUrl = data.imageUrl || null;
      if (imageUrl) {
        applyImageToSupplier(phone, imageUrl);
        if (supplier['Supplier Name']) {
          fetch('/api/suppliers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone,
              name: supplier['Supplier Name'],
              images: [imageUrl, ...(supplier.images || []).filter((i) => !String(i).startsWith('http'))],
            }),
          }).catch(() => {});
        }
        return imageUrl;
      }
      setSupplierImages((prev) => ({ ...prev, [phone]: 'error' }));
      return null;
    } catch {
      setSupplierImages((prev) => ({ ...prev, [phone]: 'error' }));
      return null;
    }
  };

  const fetchAllSupplierImages = async () => {
    const toFetch = suppliers.filter((s) => {
      const phone = s['Real Phone'] || s.phone || '';
      if (!phone || !getEngagedUrl(s)) return false;
      if (supplierImages[phone] && supplierImages[phone] !== 'error' && supplierImages[phone] !== 'loading') {
        if (supplierHasHttpImage(s)) return false;
      }
      return !supplierHasHttpImage(s);
    });

    if (toFetch.length === 0) {
      alert('כל הספקים כבר יש להם תמונות!');
      return;
    }

    setFetchingAllImages(true);
    setImageFetchProgress({ done: 0, total: toFetch.length });

    const BATCH = 5;
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH);
      await Promise.all(batch.map((s) => fetchImageForSupplier(s)));
      setImageFetchProgress({ done: Math.min(i + BATCH, toFetch.length), total: toFetch.length });
      if (i + BATCH < toFetch.length) await new Promise((r) => setTimeout(r, 400));
    }

    setFetchingAllImages(false);
  };

  // Pre-load cached http images + auto-fetch missing in background
  useEffect(() => {
    if (!suppliers.length || loading) return;

    const seeded = {};
    suppliers.forEach((s) => {
      const phone = s['Real Phone'] || s.phone || '';
      if (!phone) return;
      const http =
        s.images?.find((i) => String(i).startsWith('http')) ||
        (String(s['Google Image'] || '').startsWith('http') ? s['Google Image'] : null) ||
        (String(s['Main Image'] || '').startsWith('http') ? s['Main Image'] : null);
      if (http) seeded[phone] = http;
    });
    if (Object.keys(seeded).length) {
      setSupplierImages((prev) => ({ ...seeded, ...prev }));
    }

    const missing = suppliers.filter((s) => !supplierHasHttpImage(s) && getEngagedUrl(s)).slice(0, 30);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < missing.length; i += 5) {
        if (cancelled) break;
        await Promise.all(missing.slice(i, i + 5).map((s) => fetchImageForSupplier(s)));
        await new Promise((r) => setTimeout(r, 500));
      }
    })();

    return () => { cancelled = true; };
  }, [suppliers.length, loading]);

  const mapCategoryToFiesta = (category) => {
    if (!category) return 'design';
    const cat = category.toLowerCase();
    if (cat.includes('מוזיקה') || cat.includes('dj') || cat.includes("די ג") || cat.includes('תקליטן')) return 'dj';
    if (cat.includes('אולמות') || cat.includes('גן אירועים') || cat.includes('גני אירועים')) return 'venue';
    if (cat.includes('מאפרות') || cat.includes('איפור')) return 'makeup';
    if (cat.includes('שיער')) return 'hair';
    if (cat.includes('כלות') || cat.includes('חתן ולכלה')) return 'dresses';
    if (cat.includes('צילום')) return 'photographer';
    if (cat.includes('קייטרינג')) return 'catering';
    if (cat.includes('בר אלכוהול') || cat.includes('אלכוהול')) return 'alcohol';
    if (cat.includes('בר')) return 'bar';
    if (cat.includes('חליפות') || cat.includes('חתן')) return 'suits';
    if (cat.includes('עיצוב')) return 'design';
    if (cat.includes('הסעות') || cat.includes('תחבורה')) return 'transportation';
    if (cat.includes('זמר') || cat.includes('להקה')) return 'singers';
    if (cat.includes('אטרקציה')) return 'attractions';
    if (cat.includes('הפקה')) return 'event-production';
    return 'design';
  };

  // ── Trigger Fiesta Push Modal ─────────────────────────────────────────────
  const collectPushImages = (supplier, cachedImg) => {
    const pushImages = [];
    const add = (img) => {
      if (!img || img === 'N/A' || img === 'nan') return;
      const value = String(img).trim();
      if (!value) return;
      if (value.startsWith('http') || value.startsWith('/media/')) {
        if (!pushImages.includes(value)) pushImages.push(value);
      }
    };

    if (cachedImg) add(cachedImg);
    (supplier.images || []).forEach(add);
    add(supplier['Main Image']);
    add(supplier['Google Image']);
    if (supplier['Gallery'] && supplier['Gallery'] !== 'N/A' && supplier['Gallery'] !== 'nan') {
      String(supplier['Gallery']).split(/[,|]/).forEach(add);
    }
    return pushImages;
  };

  const triggerFiestaPush = (supplier, targetStatus = null) => {
    const mappedType = mapCategoryToFiesta(supplier.Category);
    const address = supplier['Address'] || '';
    // Extract first Hebrew word as a rough region
    const regionMatch = address.match(/[\u05D0-\u05EA]{2,}/);
    const region = regionMatch ? regionMatch[0] : '';

    // Collect all unique images — prefer https URLs (local /media/ files don't exist on disk)
    const phone = supplier['Real Phone'] || supplier['phone'] || '';
    const cachedImg = phone && typeof supplierImages[phone] === 'string' && supplierImages[phone].startsWith('http')
      ? supplierImages[phone] : null;

    const pushImages = collectPushImages(supplier, cachedImg);

    const state = supplierStates[phone];
    const uploadedImage = state ? state.uploadedImage : '';
    const isSigned = targetStatus ? (targetStatus === 'contract') : (state ? (state.status === 'contract') : false);

    setFiestaPushSupplier(supplier);
    setFiestaPushResult(null);
    setFiestaPushError('');
    setFiestaPushStep(1);
    setFiestaPushForm({
      type: mappedType,
      description: `${supplier['Category'] || ''} באזור ${address}`.trim(),
      region,
      originalPrice: '',
      price: '',
      agentCommission: '',
      commissionAmount: '',
      discountDisplayType: 'percent',
      agreementSigned: isSigned,
      selectedImages: pushImages,
      agreementImage: uploadedImage // Store the uploaded contract/screenshot here!
    });
    setShowFiestaPushModal(true);
  };

  // ── Submit to Fiesta API ──────────────────────────────────────────────────
  const submitToFiesta = async () => {
    if (!fiestaPushForm.type) {
      setFiestaPushError('יש לבחור קטגוריה לפני השליחה');
      setFiestaPushStep(2);
      return;
    }

    setFiestaPushLoading(true);
    setFiestaPushResult(null);
    setFiestaPushError('');
    try {
      // Auto-calculate discount from prices
      const orig = parseFloat(fiestaPushForm.originalPrice) || 0;
      const cust = parseFloat(fiestaPushForm.price) || 0;
      let discount = '0';
      if (orig > 0 && cust > 0 && cust < orig) {
        discount = fiestaPushForm.discountDisplayType === 'percent'
          ? String(Math.round((1 - cust / orig) * 100))
          : String(Math.round(orig - cust));
      }

      const res = await fetch('/api/push-to-fiesta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier: fiestaPushSupplier,
          fiestaData: {
            ...fiestaPushForm,
            discount,
            discountType: fiestaPushForm.discountDisplayType,
            agentName: activeAgent,
            images: fiestaPushForm.selectedImages || fiestaPushForm.images || fiestaPushSupplier?.images || [],
            reviews: fiestaPushForm.reviews || fiestaPushSupplier?.reviews || []
          }
        })
      });
      const data = await res.json();
      if (data.exists) {
        setFiestaPushResult('exists');
      } else if (data.success) {
        setFiestaPushResult('success');
        
        // Save the status and contract image to database when successful
        const phone = fiestaPushSupplier['Real Phone'] || fiestaPushSupplier['phone'] || '';
        const statusToSave = pendingStatusChange ? pendingStatusChange.status : (fiestaPushForm.agreementSigned ? 'contract' : 'not-signed');
        
        updateSupplierState(phone, {
          status: statusToSave,
          reminder: null,
          agent: activeAgent,
          uploadedImage: fiestaPushForm.agreementImage
        });
        
        setPendingStatusChange(null);
      } else {
        setFiestaPushResult('error');
        setFiestaPushError(data.error || 'שגיאה לא ידועה');
      }
    } catch (err) {
      setFiestaPushResult('error');
      setFiestaPushError(err.message);
    } finally {
      setFiestaPushLoading(false);
    }
  };

  const handleCloseFiestaPushModal = () => {
    setShowFiestaPushModal(false);
    setFiestaPushResult(null);
    setFiestaPushStep(1);
    setPendingStatusChange(null);
  };

  const handleSkipFiestaPush = () => {
    if (pendingStatusChange) {
      const phone = fiestaPushSupplier['Real Phone'] || fiestaPushSupplier['phone'] || '';
      updateSupplierState(phone, {
        status: pendingStatusChange.status,
        reminder: null,
        agent: activeAgent,
        uploadedImage: fiestaPushForm.agreementImage
      });
    }
    setShowFiestaPushModal(false);
    setFiestaPushResult(null);
    setFiestaPushStep(1);
    setPendingStatusChange(null);
  };

  const handleModalFileChange = (file) => {
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFiestaPushForm(f => ({ ...f, agreementImage: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const renderWizardHeader = (step, title) => {
    const progress = (step / 6) * 100;
    return (
      <div style={{ marginBottom: '24px', textAlign: 'center' }}>
        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
          {[1, 2, 3, 4, 5, 6].map(s => (
            <div 
              key={s} 
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: '800',
                background: s === step ? 'var(--accent)' : (s < step ? '#10b981' : '#e2e8f0'),
                color: s === step || s < step ? 'white' : 'var(--text-muted)',
                transition: 'all 0.3s ease'
              }}
            >
              {s < step ? '✓' : s}
            </div>
          ))}
        </div>
        
        {/* Progress bar */}
        <div style={{ width: '100%', height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden', marginBottom: '14px' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s ease' }}></div>
        </div>

        <h2 style={{ fontSize: '1.4rem', fontWeight: '900', color: 'var(--primary)', margin: 0 }}>
          {title}
        </h2>
      </div>
    );
  };

  const deleteSupplierImage = async (phone, imgUrl) => {
    // Find supplier
    const supplier = suppliers.find(s => (s["Real Phone"] || s["Phone Number"]) === phone);
    if (!supplier) return;
    
    // Filter out target image
    const updatedImages = (supplier.images || []).filter(url => url !== imgUrl);
    
    // Update local state suppliers list
    setSuppliers(prev => prev.map(s => {
      if ((s["Real Phone"] || s["Phone Number"]) === phone) {
        return { ...s, images: updatedImages };
      }
      return s;
    }));
    
    // Update active supplier profile modal view
    if (selectedSupplierProfile && (selectedSupplierProfile["Real Phone"] || selectedSupplierProfile["Phone Number"]) === phone) {
      setSelectedSupplierProfile(prev => ({ ...prev, images: updatedImages }));
    }
    
    // Persist changes to server
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, images: updatedImages })
      });
      const data = await res.json();
      if (!data.success) {
        console.error("Failed to save image deletion on server:", data.error);
      }
    } catch (err) {
      console.error("Error saving image deletion on server:", err);
    }
  };

  const deleteSupplierReview = async (phone, reviewIdx) => {
    // Find supplier
    const supplier = suppliers.find(s => (s["Real Phone"] || s["Phone Number"]) === phone);
    if (!supplier) return;
    
    // Filter out target review by index
    const updatedReviews = (supplier.reviews || []).filter((_, idx) => idx !== reviewIdx);
    
    // Update local state suppliers list
    setSuppliers(prev => prev.map(s => {
      if ((s["Real Phone"] || s["Phone Number"]) === phone) {
        return { ...s, reviews: updatedReviews };
      }
      return s;
    }));
    
    // Update active supplier profile modal view
    if (selectedSupplierProfile && (selectedSupplierProfile["Real Phone"] || selectedSupplierProfile["Phone Number"]) === phone) {
      setSelectedSupplierProfile(prev => ({ ...prev, reviews: updatedReviews }));
    }
    
    // Persist changes to server
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phone, 
          name: supplier["Supplier Name"], 
          reviews: updatedReviews 
        })
      });
      const data = await res.json();
      if (!data.success) {
        console.error("Failed to save review deletion on server:", data.error);
      }
    } catch (err) {
      console.error("Error saving review deletion on server:", err);
    }
  };

  const minutesUntilTomorrow = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return Math.round((tomorrow - new Date()) / 60000);
  };

  const updateSupplierState = (phone, newState) => {
    setSupplierStates(prev => ({
      ...prev,
      [phone]: { ...prev[phone], ...newState }
    }));
    fetch('/api/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, state: newState })
    })
    .then(async res => {
      if (!res.ok) {
        let errMsg = 'Failed to update state in DB';
        try {
          const errData = await res.json();
          if (errData && errData.error) {
            errMsg = errData.error;
          }
        } catch (e) {}
        throw new Error(errMsg);
      }
      return res.json();
    })
    .then(data => {
      if (!data.success) {
        console.error("Failed to update status:", data.message);
      }
    })
    .catch(err => {
      console.error("DB Save Error:", err);
      alert(`⚠️ שגיאה בשמירת הנתונים במונגו!\n\nסיבת השגיאה מהשרת: ${err.message}\n\nאנא וודא שהגדרת את MONGODB_URI ב-Vercel בצורה נכונה ושהגדרת Network Access ל-0.0.0.0/0 ב-MongoDB Atlas.`);
    });
  };

  const scheduleCallback = (phone, supplier, minutes) => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    const reminderTime = new Date(Date.now() + minutes * 60000);
    
    const isToday = reminderTime.toDateString() === new Date().toDateString();
    const isTomorrow = new Date(Date.now() + 86400000).toDateString() === reminderTime.toDateString();
    
    let timeStr = "";
    const hoursStr = reminderTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    if (isToday) {
      timeStr = `היום ב-${hoursStr}`;
    } else if (isTomorrow) {
      timeStr = `מחר ב-${hoursStr}`;
    } else {
      const dateStr = reminderTime.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
      timeStr = `${dateStr} ב-${hoursStr}`;
    }
    
    updateSupplierState(phone, { 
      callbackScheduled: timeStr,
      callbackTimestamp: reminderTime.getTime(),
      callbackDismissed: false,
      callbackEmailSent: false,
      agent: activeAgent
    });
    
    setActiveCallbackPicker(null);
    setShowReminderSuccess(true);
    setTimeout(() => setShowReminderSuccess(false), 4000);
  };

  const scheduleCustomCallback = (phone, dateTimeString) => {
    if (!dateTimeString) return;
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    const reminderTime = new Date(dateTimeString);
    if (isNaN(reminderTime.getTime())) return;
    
    const isToday = reminderTime.toDateString() === new Date().toDateString();
    const isTomorrow = new Date(Date.now() + 86400000).toDateString() === reminderTime.toDateString();
    
    let timeStr = "";
    const hoursStr = reminderTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    if (isToday) {
      timeStr = `היום ב-${hoursStr}`;
    } else if (isTomorrow) {
      timeStr = `מחר ב-${hoursStr}`;
    } else {
      const dateStr = reminderTime.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
      timeStr = `${dateStr} ב-${hoursStr}`;
    }
    
    updateSupplierState(phone, { 
      callbackScheduled: timeStr,
      callbackTimestamp: reminderTime.getTime(),
      callbackDismissed: false,
      callbackEmailSent: false,
      agent: activeAgent
    });
    
    setActiveCallbackPicker(null);
    setShowReminderSuccess(true);
    setTimeout(() => setShowReminderSuccess(false), 4000);
  };

  const dismissCallbackAlert = (phone) => {
    updateSupplierState(phone, { callbackDismissed: true });
    setCallbackAlerts(prev => prev.filter(a => a.phoneKey !== phone));
  };


  const handleLogin = (agent) => {
    const correctPassword = 'fiestamadar';

    if (password === correctPassword) {
      setActiveAgent(agent);
      setIsLoggedIn(true);
      setLoginError(false);
      if ('Notification' in window) Notification.requestPermission();
    } else {
      setLoginError(true);
    }
  };

  const updateSupplierCategory = (index, newCategory) => {
    const updatedSuppliers = [...suppliers];
    updatedSuppliers[index].Category = newCategory;
    setSuppliers(updatedSuppliers);
  };

  if (!isLoggedIn) {
    return (
      <div style={{ 
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', 
        background: 'var(--bg)', padding: '20px', dir: 'rtl' 
      }}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card" 
          style={{ maxWidth: '550px', width: '100%', textAlign: 'center' }}
        >
          <h1 className="logo" style={{ fontSize: '3rem', marginBottom: '10px' }}>Fiesta</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '30px' }}>מערכת ניהול ספקים - כניסת מורשים</p>
          
          <div style={{ marginBottom: '25px' }}>
            <p style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '12px' }}>בחר פרופיל כניסה:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {['ינון', 'מורן', 'הודיה', 'נתנאל', 'מאגר כללי'].map(agent => (
                <button
                  key={agent}
                  onClick={() => setActiveAgent(agent)}
                  style={{
                    padding: '12px', borderRadius: '10px', border: activeAgent === agent ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: activeAgent === agent ? 'var(--accent-soft)' : 'white',
                    color: activeAgent === agent ? 'var(--accent)' : 'var(--text)',
                    fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  {agent}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '30px' }}>
            <input 
              type="text" 
              placeholder="הכנס סיסמה"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ 
                width: '100%', padding: '14px', borderRadius: '10px', border: '1px solid var(--border)',
                background: '#f8fafc', textAlign: 'center', fontSize: '1.1rem', outline: 'none'
              }}
            />
            {loginError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '8px' }}>סיסמה שגויה, נסה שוב</p>}
          </div>

          <button 
            onClick={() => activeAgent ? handleLogin(activeAgent) : alert('בחר סוכן קודם')}
            className="btn-primary" 
            style={{ width: '100%', padding: '16px' }}
          >
            התחבר למערכת
          </button>
        </motion.div>
      </div>
    );
  }

  const handleFileChange = (phone, file) => {
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateSupplierState(phone, { uploadedImage: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDateChange = (phone, date) => {
    updateSupplierState(phone, { closingDate: date });
  };

  const toggleDatePicker = (phone) => {
    updateSupplierState(phone, { showDatePicker: !supplierStates[phone].showDatePicker });
  };

  const setStatus = (phone, status) => {
    if (status === 'contract' || status === 'not-signed') {
      const supplier = suppliers.find(s => (s['Real Phone'] || s['phone']) === phone);
      if (supplier) {
        setPendingStatusChange({ phone, status });
        triggerFiestaPush(supplier, status);
      }
    } else {
      updateSupplierState(phone, { status, reminder: null, agent: activeAgent });
    }
  };

  const setReminder = (phone, timeText) => {
    updateSupplierState(phone, { reminder: timeText, agent: activeAgent });
  };

  const addToCalendar = (phone, supplier, overrideReminder = null) => {
    const state = supplierStates[phone];
    const reminderType = overrideReminder || state.reminder;
    if (!reminderType) return;

    const now = new Date();
    let startTime = new Date();

    if (reminderType === 'עוד שעה') startTime.setHours(now.getHours() + 1);
    else if (reminderType === 'מחר') startTime.setDate(now.getDate() + 1);
    else if (reminderType === 'עוד שבוע') startTime.setDate(now.getDate() + 7);

    const endTime = new Date(startTime.getTime() + 30 * 60000); // 30 min duration

    const formatDate = (date) => date.toISOString().replace(/-|:|\.\d+/g, '');
    
    const title = encodeURIComponent(`חזרה לספק: ${supplier["Supplier Name"]}`);
    const details = encodeURIComponent(`סוכן: ${activeAgent}\nטלפון: ${supplier["Real Phone"]}\nקטגוריה: ${supplier["Category"]}`);
    const dates = `${formatDate(startTime)}/${formatDate(endTime)}`;

    const calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&sf=true&output=xml`;
    
    window.open(calendarUrl, '_blank');
  };

  const sendToWhatsApp = async (phone, supplier) => {
    const state = supplierStates[phone];
    if (!state.uploadedImage) {
      alert("יש להעלות צילום מסך או חוזה לפני הדיווח!");
      return;
    }

    // Try to copy the contract image to the clipboard so they can paste it in WhatsApp
    try {
      const img = new Image();
      img.src = state.uploadedImage;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      await new Promise((resolve) => {
        canvas.toBlob(async (blob) => {
          if (blob) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({
                  'image/png': blob
                })
              ]);
            } catch (e) {
              console.error("Failed to copy image to clipboard:", e);
            }
          }
          resolve();
        }, 'image/png');
      });
    } catch (err) {
      console.error("Failed to process image for clipboard:", err);
    }

    const phoneNumber = "0535378985";
    const closingDate = state.closingDate || new Date().toISOString().split('T')[0];

    // Format google rating stars
    const ratingVal = parseFloat(supplier["Google Rating"]);
    let ratingStars = "אין דירוג";
    if (!isNaN(ratingVal) && ratingVal > 0) {
      ratingStars = `${"⭐".repeat(Math.round(ratingVal))} (${ratingVal} מתוך 5)`;
    }
    
    const message = encodeURIComponent(
      `*דיווח סגירה - Fiesta* 📝\n\n` +
      `👤 סוכן: *${activeAgent}*\n` +
      `🏢 ספק: *${supplier["Supplier Name"]}*\n` +
      `📞 טלפון: ${supplier["Real Phone"] || 'לא צוין'}\n` +
      `📍 כתובת: ${supplier["Address"] || 'לא צוין'}\n` +
      `🗓️ תאריך סגירה: ${closingDate}\n\n` +
      (state.notes ? `✍️ *הערות הסוכן:*\n${state.notes}\n\n` : '') +
      `⭐ *דירוג ופרטים מהאינטרנט:*\n` +
      `- דירוג גוגל: ${ratingStars}\n` +
      `- כמות ביקורות: ${supplier["Reviews Count"] || '0'}\n` +
      `- קישור לביקורות בגוגל: ${supplier["Google Reviews Link"] || 'אין קישור'}\n` +
      `- אתר אינטרנט: ${supplier["Website"] || 'אין אתר'}\n\n` +
      `🖼️ *תמונות שנסרקו:*\n` +
      `- תמונה ראשית: ${supplier["Main Image"] || 'אין תמונה ראשית'}\n` +
      `- תמונת גוגל: ${supplier["Google Image"] || 'אין תמונת גוגל'}\n\n` +
      `📋 *חוזה/צילום מסך:*\n` +
      `תמונת החוזה הועתקה אוטומטית ללוח שלך! 📋\n` +
      `אנא לחץ *Ctrl+V* (הדבק) בצ'אט הווטסאפ שייפתח כעת כדי לשלוח את החוזה.\n\n` +
      `מערכת Fiesta`
    );
    
    window.open(`https://wa.me/972${phoneNumber.substring(1)}?text=${message}`, '_blank');
    
    // Show success message
    setTimeout(() => {
      setShowSuccessModal(true);
    }, 500);
  };

  const getStats = () => {
    const stats = {
      'ינון': { closed: 0, noAnswer: 0, thinking: 0, total: 0 },
      'מורן': { closed: 0, noAnswer: 0, thinking: 0, total: 0 },
      'הודיה': { closed: 0, noAnswer: 0, thinking: 0, total: 0 }
    };

    Object.values(supplierStates).forEach(state => {
      if (state.agent && stats[state.agent]) {
        const hasAction = state.status !== null || !!state.callbackScheduled;
        if (hasAction) {
          stats[state.agent].total++;
          if (state.status === 'contract' || state.status === 'closed') stats[state.agent].closed++;
          if (state.status === 'not-available' || state.status === 'no-answer') stats[state.agent].noAnswer++;
          if (state.status === 'thinking') stats[state.agent].thinking++;
        }
      }
    });

    return stats;
  };

  const renderManagerStats = () => {
    const stats = getStats();
    return (
      <div style={{ marginBottom: '40px' }} className="animate-in">
        <h2 style={{ fontSize: '1.5rem', fontWeight: '800', marginBottom: '20px', color: 'var(--primary)' }}>סיכום ביצועים - מבט מנהל</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          {['ינון', 'מורן', 'הודיה'].map(agent => (
            <div key={agent} className="glass-card" style={{ borderTop: '4px solid var(--accent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <div style={{ width: '40px', height: '40px', background: 'var(--accent-soft)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <User size={24} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: '800' }}>סוכן: {agent}</h3>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div style={{ textAlign: 'center', padding: '10px', background: '#f0fdf4', borderRadius: '10px' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: '900', color: '#10b981' }}>{stats[agent].closed}</p>
                  <p style={{ fontSize: '0.7rem', fontWeight: '700', color: '#047857' }}>סגירות</p>
                </div>
                <div style={{ textAlign: 'center', padding: '10px', background: '#fffbeb', borderRadius: '10px' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: '900', color: '#f59e0b' }}>{stats[agent].noAnswer}</p>
                  <p style={{ fontSize: '0.7rem', fontWeight: '700', color: '#b45309' }}>לא ענו</p>
                </div>
                <div style={{ textAlign: 'center', padding: '10px', background: '#f5f3ff', borderRadius: '10px' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: '900', color: '#8b5cf6' }}>{stats[agent].thinking}</p>
                  <p style={{ fontSize: '0.7rem', fontWeight: '700', color: '#6d28d9' }}>חושבים</p>
                </div>
              </div>
              
              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                סה"כ פעולות: <strong>{stats[agent].total}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAgentTargets = () => {
    if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') return null;

    if (activeAgent === 'הודיה') {
      return (
        <div style={{ marginBottom: '30px' }} className="animate-in">
          <div className="glass-card" style={{ 
            padding: '25px', 
            textAlign: 'center', 
            background: 'linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)',
            border: '2px solid #fbcfe8'
          }}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#db2777' }}>
              תודה רבה לאישה הטובה והיפה בעולם ✨
            </h3>
          </div>
        </div>
      );
    }

    const dailyTarget = activeAgent === 'מורן' ? 7 : 50;
    const weeklyTarget = activeAgent === 'מורן' ? 35 : 250;
    
    // Count how many suppliers the current agent has acted on (including scheduled callbacks)
    const callsDone = Object.values(supplierStates).filter(state => 
      state.agent === activeAgent && (state.status !== null || !!state.callbackScheduled)
    ).length;

    const dailyRemaining = Math.max(0, dailyTarget - callsDone);
    const dailyProgress = Math.min(100, (callsDone / dailyTarget) * 100);

    return (
      <div style={{ marginBottom: '30px' }} className="animate-in">
        <div className="glass-card" style={{ padding: '20px', borderRight: '6px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '800' }}>היעד היומי שלך</h3>
              {activeAgent === 'מורן' && dailyRemaining > 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: '700' }}>⚠️ שימי לב מורן, נשארו עוד {dailyRemaining} שיחות כדי להגיע ליעד!</p>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>נשארו עוד {dailyRemaining} שיחות ליעד היום</p>
              )}
            </div>
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: '900', color: 'var(--accent)' }}>{callsDone}</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}> / {dailyTarget}</span>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div style={{ width: '100%', height: '10px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${dailyProgress}%` }}
              style={{ height: '100%', background: 'linear-gradient(90deg, #8b5cf6, #d946ef)', borderRadius: '10px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '0.75rem', fontWeight: '700' }}>
            <span style={{ color: 'var(--text-muted)' }}>יעד שבועי: {callsDone} / {weeklyTarget}</span>
            <span style={{ color: dailyProgress === 100 ? '#10b981' : 'var(--accent)' }}>
              {dailyProgress === 100 ? 'היעד הושלם! 🎉' : `${Math.round(dailyProgress)}% הושלם`}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const getSupplierTab = (phone) => {
    const state = supplierStates[phone] || { status: null };
    const isHandled = state.status === 'not-interested' || state.status === 'contract';
    const isCallback = !!state.callbackScheduled || state.status === 'thinking' || state.status === 'no-answer';

    if (state.status === 'not-available') return 'לא ענו';
    if (state.status === 'not-signed') return 'עדיין לא חתם';
    if (isHandled) return 'טופלו';
    if (isCallback) return 'לחזור אליהם';
    return 'לטיפול';
  };

  const filteredSuppliers = suppliers
    .filter((s, i) => {
      if (searchQuery) return true;
      
      if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') return true;
      const allowedCategories = agentCategoryMap[activeAgent] || [];
      
      if (s.Category === "ספקים ללא קטגוריה" || !s.Category) return true;
      
      const matches = allowedCategories.some(cat => s.Category.includes(cat));
      if (!matches) return false;

      const brideCategories = ['מאפרות', 'שיער', 'כלות', 'לחתן ולכלה'];
      const isBrideCategory = brideCategories.some(cat => s.Category.includes(cat));
      
      if (isBrideCategory) {
        if (activeAgent === 'מורן' && i % 2 !== 0) return false;
        if (activeAgent === 'הודיה' && i % 2 !== 1) return false;
      }

      return true;
    })
    .filter((s) => {
      if (searchQuery) return true;
      
      const phone = s["Real Phone"] || s["phone"];
      const state = supplierStates[phone] || { status: null };
      const isHandled = state.status === 'not-interested' || state.status === 'contract';
      const isCallback = !!state.callbackScheduled || state.status === 'thinking' || state.status === 'no-answer';
      
      if (state.status === 'not-available') {
        return activeTab === 'לא ענו';
      }
      if (state.status === 'not-signed') {
        return activeTab === 'עדיין לא חתם';
      }
      
      if (activeTab === 'לטיפול') return !isHandled && !isCallback;
      if (activeTab === 'לחזור אליהם') return !isHandled && isCallback;
      if (activeTab === 'לא ענו') return false;
      if (activeTab === 'עדיין לא חתם') return false;
      return isHandled;
    })
    .filter((s) => {
      if (!searchQuery) return true;
      const supplierNumber = suppliers.indexOf(s) + 1;
      return supplierMatchesSearch(s, searchQuery, supplierNumber);
    })
    .filter((s) => {
      const name = (s['Supplier Name'] || s.clean_name || '').trim();
      const phone = s['Real Phone'] || s.phone || '';
      return name && name !== 'ספק ללא שם' && phone && phone !== 'FAILED' && phone !== 'N/A';
    });

  const displaySuppliers = filteredSuppliers;

  return (
    <div className="dashboard-container" dir="rtl">
      {apiHealthWarning && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 9999,
          background: '#7f1d1d',
          color: '#fff',
          padding: '12px 16px',
          textAlign: 'center',
          fontSize: '0.95rem',
          fontWeight: 600,
          borderBottom: '2px solid #ef4444',
        }}>
          ⚠️ {apiHealthWarning}
        </div>
      )}
      {activeAgent === 'נתנאל' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(135deg, #bf953f 0%, #fcf6ba 25%, #b38728 50%, #fbf5b7 75%, #aa771c 100%)',
          zIndex: -1
        }} />
      )}
      {/* Compact Hero Section */}
      <section className="hero-section animate-in">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentMediaIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          >
            {heroMedia[currentMediaIndex].type === 'video' ? (
              <video 
                autoPlay 
                muted 
                loop 
                playsInline
                className="hero-media"
                key={heroMedia[currentMediaIndex].src}
              >
                <source src={heroMedia[currentMediaIndex].src} type="video/mp4" />
              </video>
            ) : (
              <img 
                src={heroMedia[currentMediaIndex].src} 
                className="hero-media" 
                alt="Fiesta Hero" 
              />
            )}
          </motion.div>
        </AnimatePresence>
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <h1 style={{ fontSize: '2.5rem', fontWeight: '900', letterSpacing: '-1px', marginBottom: '4px', textShadow: '0 2px 10px rgba(0,0,0,0.3)' }}>FIESTA</h1>
          <p style={{ fontSize: '1rem', fontWeight: '500', opacity: 0.9, textShadow: '0 1px 5px rgba(0,0,0,0.3)' }}>Experience Luxury Management</p>
        </div>
        
        {/* Carousel Indicators */}
        <div style={{ position: 'absolute', bottom: '15px', display: 'flex', gap: '6px', zIndex: 10 }}>
          {heroMedia.map((_, idx) => (
            <div 
              key={idx}
              style={{ 
                width: '8px', height: '8px', borderRadius: '50%', 
                background: currentMediaIndex === idx ? 'white' : 'rgba(255,255,255,0.4)',
                transition: 'all 0.3s'
              }}
            />
          ))}
        </div>
      </section>

      {/* Success Celebration Modal */}
      <AnimatePresence>
        {showSuccessModal && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '20px'
          }}>
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="glass-card"
              style={{ maxWidth: '500px', width: '100%', textAlign: 'center', padding: '40px' }}
            >
              <div style={{ fontSize: '4rem', marginBottom: '20px' }}>💰</div>
              <h2 style={{ fontSize: '1.8rem', fontWeight: '800', marginBottom: '16px', color: 'var(--primary)' }}>כל הכבוד, {activeAgent}!</h2>
              <p style={{ fontSize: '1.2rem', lineHeight: '1.6', marginBottom: '30px' }}>
                "אתה עושה עבודה כל כך נפלאה אני באמת באמת מעריך אותך.<br/>
                <strong>צעד קטן לספק, צעד גדול אל הכסף.</strong>"
              </p>
              <button 
                onClick={() => setShowSuccessModal(false)}
                className="btn-primary" 
                style={{ width: '100%' }}
              >
                תודה, נמשיך לעבוד!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reminder Success Toast */}
      <AnimatePresence>
        {showReminderSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            style={{
              position: 'fixed',
              bottom: '40px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#10b981',
              color: 'white',
              padding: '16px 24px',
              borderRadius: '50px',
              boxShadow: '0 10px 25px rgba(16, 185, 129, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 3000,
              fontWeight: '700',
              fontSize: '1rem'
            }}
          >
            <CheckCircle2 size={24} />
            התזכורת נשמרה בהצלחה! נתזכר אותך במועד שנבחר
          </motion.div>
        )}
      </AnimatePresence>

      {/* Callback Alerts Banner */}
      {callbackAlerts.length > 0 && (
        <div style={{ 
          position: 'fixed', 
          top: '20px', 
          left: '20px', 
          zIndex: 9999, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px', 
          width: 'calc(100% - 40px)', 
          maxWidth: '420px',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '6px',
          direction: 'rtl'
        }}>
          {callbackAlerts.map(alert => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -50, scale: 0.9 }}
              layout
              style={{ 
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))', 
                backdropFilter: 'blur(16px)',
                color: 'white', 
                padding: '18px', 
                borderRadius: '20px', 
                display: 'flex', 
                flexDirection: 'column',
                gap: '12px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                borderRight: '6px solid var(--accent)',
                transition: 'all 0.3s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <motion.div 
                    animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                    transition={{ repeat: Infinity, duration: 2, repeatDelay: 2 }}
                    style={{ fontSize: '1.5rem' }}
                  >
                    ⏰
                  </motion.div>
                  <div>
                    <h4 style={{ fontWeight: '800', fontSize: '1.1rem', marginBottom: '2px', color: '#f8fafc' }}>
                      {alert.supplierName}
                    </h4>
                    <p style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                      הגיע זמן לחזור לספק! (נקבע ל-{alert.scheduledTime})
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => dismissCallbackAlert(alert.phoneKey)}
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.1)', 
                    border: 'none', 
                    borderRadius: '50%', 
                    width: '28px', 
                    height: '28px', 
                    color: '#94a3b8', 
                    fontWeight: '800', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    fontSize: '0.85rem',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.color = '#94a3b8'; }}
                  title="סגור תזכורת"
                >
                  ✕
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <a 
                  href={`tel:${alert.phone}`} 
                  className="btn-primary" 
                  style={{ 
                    flex: 1, 
                    padding: '8px 12px', 
                    fontSize: '0.85rem',
                    borderRadius: '10px',
                    background: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    color: 'white',
                    textDecoration: 'none',
                    fontWeight: '700'
                  }}
                >
                  <Phone size={14} />
                  <span>התקשר עכשיו ({alert.phone})</span>
                </a>
                <button
                  onClick={() => dismissCallbackAlert(alert.phoneKey)}
                  style={{ 
                    padding: '8px 12px', 
                    fontSize: '0.85rem', 
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'transparent',
                    color: '#cbd5e1',
                    fontWeight: '700',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#cbd5e1'; }}
                >
                  סמן כטופל
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <header className="animate-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', fontWeight: '600' }}>ברוך הבא {activeAgent}, יום פורה! 🚀</p>
        </div>
        
        {/* Agent Selector & Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', background: '#e2e8f0', padding: '4px', borderRadius: '10px', gap: '2px' }}>
            {['ינון', 'מורן', 'הודיה', 'נתנאל', 'מאגר כללי'].map(agent => (
              <button
                key={agent}
                onClick={() => setActiveAgent(agent)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeAgent === agent ? 'white' : 'transparent',
                  color: activeAgent === agent ? 'var(--primary)' : 'var(--text-muted)',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontSize: '0.75rem'
                }}
              >
                {agent}
              </button>
            ))}
          </div>
          <button 
            onClick={() => { setIsLoggedIn(false); setPassword(''); }}
            style={{ 
              padding: '6px', borderRadius: '50%', border: '1px solid var(--border)', 
              background: 'white', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            title="יציאה"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {activeAgent === 'נתנאל' && renderManagerStats()}
      {renderAgentTargets()}

      {activeAgent && activeAgent !== 'נתנאל' && activeAgent !== 'מאגר כללי' && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('לטיפול')}
            style={{
              padding: '10px 24px', borderRadius: '20px', border: 'none',
              background: activeTab === 'לטיפול' ? 'var(--primary)' : '#e2e8f0',
              color: activeTab === 'לטיפול' ? 'white' : 'var(--text-muted)',
              fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            ספקים לטיפול
          </button>
          <button
            onClick={() => setActiveTab('לחזור אליהם')}
            style={{
              padding: '10px 24px', borderRadius: '20px', border: 'none',
              background: activeTab === 'לחזור אליהם' ? '#f59e0b' : '#e2e8f0',
              color: activeTab === 'לחזור אליהם' ? 'white' : 'var(--text-muted)',
              fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            לחזור אליהם ⏰
          </button>
          <button
            onClick={() => setActiveTab('לא ענו')}
            style={{
              padding: '10px 24px', borderRadius: '20px', border: 'none',
              background: activeTab === 'לא ענו' ? '#f97316' : '#e2e8f0',
              color: activeTab === 'לא ענו' ? 'white' : 'var(--text-muted)',
              fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            לא ענו 📵
          </button>
          <button
            onClick={() => setActiveTab('עדיין לא חתם')}
            style={{
              padding: '10px 24px', borderRadius: '20px', border: 'none',
              background: activeTab === 'עדיין לא חתם' ? '#3b82f6' : '#e2e8f0',
              color: activeTab === 'עדיין לא חתם' ? 'white' : 'var(--text-muted)',
              fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            עדיין לא חתם ⏳
          </button>
          <button
            onClick={() => setActiveTab('טופלו')}
            style={{
              padding: '10px 24px', borderRadius: '20px', border: 'none',
              background: activeTab === 'טופלו' ? '#10b981' : '#e2e8f0',
              color: activeTab === 'טופלו' ? 'white' : 'var(--text-muted)',
              fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            ספקים שטופלו
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-muted)' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }}></div>
          טוען ספקים...
        </div>
      ) : (
        <>
          {/* Premium Search Bar */}
          <div style={{ marginBottom: '24px' }} className="animate-in">
            <div className="glass-card" style={{ 
              padding: '16px 20px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px',
              background: 'var(--card-bg)',
              borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(139, 92, 246, 0.05)',
              border: '1px solid var(--border)',
              transition: 'all 0.3s ease',
              direction: 'rtl'
            }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ 
                  position: 'absolute', 
                  right: '16px', 
                  top: '50%', 
                  transform: 'translateY(-50%)', 
                  fontSize: '1.2rem',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                  zIndex: 2
                }}>
                  🔍
                </span>
                <input 
                  type="text" 
                  placeholder="חפש ספק לפי שם, מספר טלפון או מספר ספק (#)..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '14px 48px 14px 16px',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    background: '#f8fafc',
                    fontSize: '1rem',
                    fontWeight: '500',
                    outline: 'none',
                    transition: 'all 0.2s ease',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    paddingRight: '48px'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--accent)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.15)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--border)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      left: '16px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: '#e2e8f0',
                      border: 'none',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      color: 'var(--text-muted)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      transition: 'all 0.2s',
                      zIndex: 2
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#cbd5e1'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#e2e8f0'}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {searchQuery && (
            <div style={{ 
              background: 'var(--accent-soft)', 
              border: '1px solid rgba(139, 92, 246, 0.2)',
              color: 'var(--accent)', 
              padding: '10px 16px', 
              borderRadius: '10px', 
              marginBottom: '20px',
              fontSize: '0.9rem',
              fontWeight: '700',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              animation: 'fadeIn 0.3s ease-out'
            }}>
              <span>
                🔎 נמצאו {displaySuppliers.length} תוצאות עבור "{searchQuery}" (מכל הלשוניות)
              </span>
              <button 
                onClick={() => setSearchQuery('')}
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--accent)', 
                  fontWeight: '800', 
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                בטל חיפוש
              </button>
            </div>
          )}

          {/* Fetch All Images Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button
              onClick={fetchAllSupplierImages}
              disabled={fetchingAllImages}
              style={{
                padding: '8px 18px', borderRadius: '20px', border: 'none',
                background: fetchingAllImages ? '#e2e8f0' : 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                color: fetchingAllImages ? '#94a3b8' : 'white',
                fontWeight: '700', cursor: fetchingAllImages ? 'default' : 'pointer',
                fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              {fetchingAllImages
                ? `⏳ טוען תמונות... ${imageFetchProgress.done}/${imageFetchProgress.total}`
                : '📷 טען תמונות לכל הספקים'}
            </button>
            {imageFetchProgress.total > 0 && !fetchingAllImages && (
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                ✅ {imageFetchProgress.done} תמונות נטענו
              </span>
            )}
          </div>

          <div className="suppliers-grid">
            {displaySuppliers.length === 0 ? (
              <div style={{ 
                gridColumn: '1 / -1', 
                textAlign: 'center', 
                padding: '60px 20px', 
                color: 'var(--text-muted)',
                background: 'white',
                borderRadius: '16px',
                border: '1px dashed var(--border)',
                width: '100%'
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔍</div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '8px', color: 'var(--primary)' }}>לא נמצאו ספקים תואמים</h3>
                <p style={{ fontSize: '0.9rem' }}>נסה לחפש לפי שם אחר, מספר טלפון מלא או מספר ספק תקין.</p>
              </div>
            ) : (
              displaySuppliers.map((s) => {
                const phone = s["Real Phone"] || s["phone"];
                const state = supplierStates[phone] || { status: null };
                const supplierNumber = suppliers.indexOf(s) + 1;
                const cardKey = `${s.id ?? 'no-id'}-${phone}-${supplierNumber}`;
                const supplierTab = getSupplierTab(phone);

                return (
                  <motion.div 
                    key={cardKey}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-card"
                    style={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      justifyContent: 'space-between',
                      height: '100%',
                      borderRight: state.status === 'not-interested' ? '4px solid #ef4444' :
                                   state.status === 'not-available' ? '4px solid #f97316' : 
                                   state.status === 'contract' ? '4px solid #10b981' : 
                                   state.status === 'not-signed' ? '4px solid #3b82f6' : 
                                   state.callbackScheduled ? '4px solid #0ea5e9' : '1px solid var(--border)'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="category-tag">{s["Category"] || "כללי"}</span>
                          {searchQuery && supplierTab !== activeTab && (
                            <span style={{
                              fontSize: '0.72rem', color: '#6366f1', background: '#eef2ff',
                              padding: '3px 8px', borderRadius: '6px', fontWeight: '700',
                              border: '1px solid #c7d2fe'
                            }}>
                              📁 בלשונית: {supplierTab}
                            </span>
                          )}
                          {state.reminder && (
                            <div style={{ 
                              fontSize: '0.75rem', color: '#8b5cf6', background: '#f5f3ff', 
                              padding: '4px 10px', borderRadius: '6px', fontWeight: 'bold',
                              border: '1px solid #ddd6fe', display: 'flex', alignItems: 'center', gap: '6px'
                            }}>
                              <Calendar size={12} />
                              <span>{state.agent}, יש ספק שצריך לתזכר ולבדוק מה איתו מיידית ({state.reminder})</span>
                            </div>
                          )}
                        </div>
                        <div 
                          className="date-trigger" 
                          onClick={() => toggleDatePicker(phone)}
                          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--primary)' }}
                        >
                          <Calendar size={16} />
                          <span>{state.closingDate || 'תאריך'}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--primary)', margin: 0, maxWidth: '70%' }}>
                          {s["Supplier Name"] || s.clean_name || 'ספק ללא שם'}
                        </h3>
                        <span style={{ 
                          fontSize: '0.75rem', 
                          color: 'var(--accent)', 
                          fontWeight: '800', 
                          background: 'var(--accent-soft)', 
                          padding: '4px 10px', 
                          borderRadius: '8px',
                          border: '1px solid rgba(139, 92, 246, 0.2)'
                        }}>
                          ספק #{supplierNumber}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '10px' }}>{s["Address"] || "מיקום לא צוין"}</p>

                      {/* Full Profile Button */}
                      <button 
                        onClick={() => setSelectedSupplierProfile(s)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          marginBottom: '20px',
                          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'all 0.2s',
                          fontFamily: 'inherit',
                          fontSize: '0.9rem'
                        }}
                      >
                        📄 הצג פרופיל ספק מורחב
                      </button>

                       {/* Supplier Image */}
                       {(() => {
                         const imgUrl = getSupplierImage(s);
                         const isLoading = supplierImages[phone] === 'loading';
                         if (imgUrl) return (
                           <div style={{ marginBottom: '12px', borderRadius: '10px', overflow: 'hidden', height: '130px', background: '#f1f5f9' }}>
                             <img
                               src={imgUrl}
                               alt={s["Supplier Name"]}
                               style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                               onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                             />
                           </div>
                         );
                         if (isLoading) return (
                           <div style={{ marginBottom: '12px', borderRadius: '10px', height: '130px', background: 'linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
                         );
                         return (
                           <div
                             onClick={() => fetchImageForSupplier(s)}
                             style={{ marginBottom: '12px', borderRadius: '10px', height: '80px', background: '#f8fafc', border: '1.5px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: '6px', color: '#94a3b8', fontSize: '0.8rem' }}
                             title="לחץ לטעינת תמונה"
                           >
                             📷 לחץ לטעינת תמונה
                           </div>
                         );
                       })()}

                       {/* Google Rating + Reviews + Website */}
                       <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                         {s["Google Rating"] && parseFloat(s["Google Rating"]) > 0 && parseFloat(s["Google Rating"]) <= 10 && (
                           <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.8rem', fontWeight: '700' }}>
                             <span style={{ color: '#f59e0b' }}>{'⭐'.repeat(Math.min(5, Math.round(parseFloat(s["Google Rating"]))))}</span>
                             <span style={{ color: 'var(--text)' }}>{parseFloat(s["Google Rating"]).toFixed(1)}</span>
                             {s["Reviews Count"] && parseInt(s["Reviews Count"]) > 0 && (
                               <span style={{ color: 'var(--text-muted)', fontWeight: '500', fontSize: '0.75rem' }}>({s["Reviews Count"]} ביקורות)</span>
                             )}
                           </div>
                         )}
                         {s["Google Reviews Link"] && (
                           <a href={s["Google Reviews Link"].startsWith('http') ? s["Google Reviews Link"] : `https://${s["Google Reviews Link"]}`} target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: '0.72rem', fontWeight: '700', color: '#4285f4', textDecoration: 'none',
                               background: '#f0f4ff', padding: '2px 8px', borderRadius: '5px', border: '1px solid #c7d2fe' }}>
                             🔗 ביקורות גוגל
                           </a>
                         )}
                         {s["Website"] && (
                           <a href={s["Website"].startsWith('http') ? s["Website"] : `https://${s["Website"]}`}
                             target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: '0.72rem', fontWeight: '700', color: '#10b981', textDecoration: 'none',
                               background: '#f0fdf4', padding: '2px 8px', borderRadius: '5px', border: '1px solid #bbf7d0' }}>
                             🌐 אתר
                           </a>
                         )}
                       </div>
                    </div>

                    <div>
                      {/* Notes Input */}
                      <textarea
                        placeholder="✍️ הערות מיוחדות לדיווח..."
                        value={state.notes || ""}
                        onChange={(e) => updateSupplierState(phone, { notes: e.target.value })}
                        style={{
                          width: '100%',
                          height: '50px',
                          padding: '8px 12px',
                          borderRadius: '10px',
                          border: '1px solid var(--border)',
                          background: '#f8fafc',
                          fontSize: '0.8rem',
                          resize: 'none',
                          marginBottom: '10px',
                          fontFamily: 'inherit',
                          outline: 'none',
                          transition: 'border-color 0.2s',
                          direction: 'rtl'
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                      />

                      {/* Action Buttons */}
                      <div className="card-actions-grid">
                        <button
                          onClick={() => setStatus(phone, 'contract')}
                          style={{
                            padding: '9px 6px', borderRadius: '10px', border: '1px solid #10b981',
                            background: state.status === 'contract' ? '#10b981' : 'transparent',
                            color: state.status === 'contract' ? 'white' : '#10b981',
                            fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer'
                          }}
                        >
                          ✅ נשלח חוזה ונחתם
                        </button>
                        <button
                          onClick={() => setStatus(phone, 'not-interested')}
                          style={{
                            padding: '9px 6px', borderRadius: '10px', border: '1px solid #ef4444',
                            background: state.status === 'not-interested' ? '#ef4444' : 'transparent',
                            color: state.status === 'not-interested' ? 'white' : '#ef4444',
                            fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer'
                          }}
                        >
                          ❌ לא מעוניין
                        </button>
                        <button
                          onClick={() => {
                            setStatus(phone, 'not-available');
                            setActiveTab('לא ענו');
                          }}
                          style={{
                            padding: '9px 6px', borderRadius: '10px', border: '1px solid #f97316',
                            background: state.status === 'not-available' ? '#f97316' : 'transparent',
                            color: state.status === 'not-available' ? 'white' : '#f97316',
                            fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer'
                          }}
                        >
                          📵 לא זמין / לא ענו
                        </button>
                        <button
                          onClick={() => {
                            setStatus(phone, 'not-signed');
                            setActiveTab('עדיין לא חתם');
                          }}
                          style={{
                            padding: '9px 6px', borderRadius: '10px', border: '1px solid #3b82f6',
                            background: state.status === 'not-signed' ? '#3b82f6' : 'transparent',
                            color: state.status === 'not-signed' ? 'white' : '#3b82f6',
                            fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer'
                          }}
                        >
                          ⏳ עדיין לא חתם
                        </button>
                        <button
                          onClick={() => setActiveCallbackPicker(activeCallbackPicker === phone ? null : phone)}
                          style={{
                            padding: '9px 6px', borderRadius: '10px',
                            border: `1px solid ${state.callbackScheduled ? '#0ea5e9' : '#0284c7'}`,
                            background: state.callbackScheduled ? '#0ea5e9' : (activeCallbackPicker === phone ? '#0284c7' : 'transparent'),
                            color: state.callbackScheduled ? 'white' : (activeCallbackPicker === phone ? 'white' : '#0284c7'),
                            fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer',
                            gridColumn: 'span 2'
                          }}
                        >
                          {state.callbackScheduled ? `⏰ ${state.callbackScheduled}` : '⏰ לחזור מאוחר יותר'}
                        </button>
                      </div>

                      <AnimatePresence>
                        {activeCallbackPicker === phone && (
                          <motion.div
                            key="callback-picker"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            style={{ background: '#f0f9ff', padding: '14px', borderRadius: '12px', marginBottom: '12px', overflow: 'hidden', border: '1px solid #bae6fd' }}
                          >
                            <p style={{ fontSize: '0.75rem', fontWeight: '800', color: '#0369a1', marginBottom: '10px' }}>⏰ בחר שעה לחזרה לספק:</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                              {[
                                { label: 'עוד דקה (בדיקה)', minutes: 1 },
                                { label: 'עוד 30 דק׳', minutes: 30 },
                                { label: 'עוד שעה', minutes: 60 },
                                { label: 'עוד 2 שעות', minutes: 120 },
                                { label: 'מחר 9:00', minutes: minutesUntilTomorrow() },
                                { label: 'עוד יומיים', minutes: 2880 },
                              ].map(opt => (
                                <button
                                  key={opt.label}
                                  onClick={() => scheduleCallback(phone, s, opt.minutes)}
                                  style={{
                                    padding: '8px 4px', borderRadius: '8px',
                                    border: '1px solid #bae6fd', background: 'white',
                                    color: '#0369a1', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer'
                                  }}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>

                            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #bae6fd' }}>
                              <p style={{ fontSize: '0.75rem', fontWeight: '800', color: '#0369a1', marginBottom: '8px' }}>📅 או בחר מועד מותאם אישית:</p>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input 
                                  type="datetime-local" 
                                  id={`custom-date-${phone}`}
                                  style={{
                                    flex: 1,
                                    padding: '8px',
                                    borderRadius: '8px',
                                    border: '1px solid #bae6fd',
                                    fontSize: '0.8rem',
                                    color: '#0369a1',
                                    outline: 'none',
                                    background: 'white',
                                    fontFamily: 'inherit'
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    const val = document.getElementById(`custom-date-${phone}`).value;
                                    if (val) {
                                      scheduleCustomCallback(phone, val);
                                    } else {
                                      alert('אנא בחר תאריך ושעה');
                                    }
                                  }}
                                  style={{
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    background: '#0284c7',
                                    color: 'white',
                                    border: 'none',
                                    fontWeight: '700',
                                    fontSize: '0.75rem',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s'
                                  }}
                                  onMouseOver={(e) => e.target.style.background = '#0369a1'}
                                  onMouseOut={(e) => e.target.style.background = '#0284c7'}
                                >
                                  אישור
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <AnimatePresence mode="wait">

                        {state.status === 'contract' && (
                          <motion.div
                            key="closed-menu"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <div 
                              className="upload-zone"
                              onClick={() => document.getElementById(`file-${phone}`).click()}
                              style={{ marginBottom: '16px', background: state.uploadedImage ? '#f0fdf4' : 'transparent', borderColor: state.uploadedImage ? '#bbf7d0' : 'var(--border)', cursor: 'pointer' }}
                            >
                              <input 
                                id={`file-${phone}`}
                                type="file" 
                                onChange={(e) => handleFileChange(phone, e.target.files[0])}
                                style={{ display: 'none' }}
                                accept="image/*"
                              />
                              {state.uploadedImage ? (
                                <div style={{ color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: '600' }}>
                                  <CheckCircle2 size={18} />
                                  <span>חוזה/צילום מסך צורף</span>
                                </div>
                              ) : (
                                <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.85rem' }}>
                                  <Upload size={18} />
                                  <span>צרף חוזה או צילום מסך</span>
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                              <button 
                                onClick={() => sendToWhatsApp(phone, s)}
                                className="btn-primary btn-whatsapp" 
                                style={{ 
                                  flex: 1, padding: '12px',
                                  opacity: state.uploadedImage ? 1 : 0.5,
                                  cursor: state.uploadedImage ? 'pointer' : 'not-allowed'
                                }}
                              >
                                <MessageCircle size={20} />
                                <span>דיווח בוואטצאפ</span>
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Date Picker (hidden by default) */}
                      <AnimatePresence>
                        {state.showDatePicker && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            style={{ overflow: 'hidden', marginTop: '10px' }}
                          >
                            <input 
                              type="date" 
                              value={state.closingDate}
                              onChange={(e) => handleDateChange(phone, e.target.value)}
                              style={{ 
                                width: '100%', padding: '10px', borderRadius: '8px', 
                                border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: '0.9rem'
                              }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div style={{ display: 'flex', gap: '8px', marginTop: state.status === 'closed' ? '8px' : '0' }}>
                        <a href={`tel:${s["Real Phone"]}`} className="btn-primary" style={{ flex: 1, padding: '12px' }}>
                          <Phone size={20} />
                          <span>התקשר עכשיו</span>
                        </a>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── Supplier Profile Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedSupplierProfile && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000, padding: '20px', direction: 'rtl'
          }}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card"
              style={{ maxWidth: '800px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '30px', position: 'relative' }}
            >
              <button 
                onClick={() => setSelectedSupplierProfile(null)}
                style={{ position: 'absolute', top: '15px', left: '15px', background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                ✕
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {getSupplierImage(selectedSupplierProfile) && (
                  <img 
                    src={getSupplierImage(selectedSupplierProfile)} 
                    style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--primary)' }} 
                    alt="" 
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--primary)', margin: 0 }}>{selectedSupplierProfile["Supplier Name"]}</h2>
                  <span className="category-tag" style={{ display: 'inline-block', marginTop: '5px' }}>{selectedSupplierProfile["Category"]}</span>
                </div>
                <button
                  onClick={() => triggerFiestaPush(selectedSupplierProfile)}
                  style={{
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
                    color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px',
                    fontSize: '0.95rem', fontWeight: '800', cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(139, 92, 246, 0.25)', transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(139, 92, 246, 0.35)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.25)'; }}
                >
                  🚀 העלה לפייסטה
                </button>
              </div>

              <div style={{ marginBottom: '25px', background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '800', color: 'var(--accent)', margin: 0 }}>📝 אודות העסק</h3>
                  {!isEditingDescription && (
                    <button
                      onClick={() => {
                        setEditedDescriptionText(selectedSupplierProfile.description || '');
                        setIsEditingDescription(true);
                      }}
                      style={{
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                        border: 'none', padding: '6px 12px', borderRadius: '6px',
                        fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}
                    >
                      ✏️ ערוך תיאור
                    </button>
                  )}
                </div>

                {isEditingDescription ? (
                  <div>
                    <textarea
                      value={editedDescriptionText}
                      onChange={(e) => setEditedDescriptionText(e.target.value)}
                      rows={6}
                      style={{
                        width: '100%', padding: '12px', borderRadius: '8px',
                        border: '1.5px solid var(--accent)', fontSize: '0.95rem',
                        lineHeight: '1.6', fontFamily: 'inherit', resize: 'vertical',
                        outline: 'none', background: 'white', color: 'var(--text)'
                      }}
                      placeholder="הוסף או ערוך את תיאור העסק..."
                    />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                      <button
                        onClick={async () => {
                          setDescriptionSaving(true);
                          const phone = selectedSupplierProfile["Real Phone"] || selectedSupplierProfile["Phone Number"];
                          const name = selectedSupplierProfile["Supplier Name"];
                          
                          try {
                            const res = await fetch('/api/suppliers', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ phone, name, description: editedDescriptionText })
                            });
                            const data = await res.json();
                            if (data.success) {
                              setSuppliers(prev => prev.map(s => {
                                if ((s["Real Phone"] || s["Phone Number"]) === phone) {
                                  return { ...s, description: editedDescriptionText };
                                }
                                return s;
                              }));
                              setSelectedSupplierProfile(prev => ({ ...prev, description: editedDescriptionText }));
                              setIsEditingDescription(false);
                            } else {
                              alert("שגיאה בשמירת התיאור: " + data.error);
                            }
                          } catch (err) {
                            alert("שגיאה בחיבור לשרת: " + err.message);
                          } finally {
                            setDescriptionSaving(false);
                          }
                        }}
                        disabled={descriptionSaving}
                        style={{
                          background: '#10b981', color: 'white', border: 'none',
                          padding: '6px 12px', borderRadius: '6px', fontSize: '0.85rem',
                          fontWeight: '700', cursor: 'pointer', opacity: descriptionSaving ? 0.7 : 1
                        }}
                      >
                        {descriptionSaving ? 'שומר...' : 'שמור'}
                      </button>
                      <button
                        onClick={() => setIsEditingDescription(false)}
                        disabled={descriptionSaving}
                        style={{
                          background: 'white', color: '#555', border: '1px solid var(--border)',
                          padding: '6px 12px', borderRadius: '6px', fontSize: '0.85rem',
                          fontWeight: '700', cursor: 'pointer'
                        }}
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ lineHeight: '1.6', fontSize: '0.95rem', margin: 0, color: selectedSupplierProfile.description ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                    {selectedSupplierProfile.description || 'אין תיאור לספק זה. לחץ על ערוך כדי להוסיף תיאור.'}
                  </p>
                )}
              </div>

              {selectedSupplierProfile.images && selectedSupplierProfile.images.length > 0 && (
                <div style={{ marginBottom: '25px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '15px', color: 'var(--accent)' }}>📸 תמונות גלריה</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
                    {selectedSupplierProfile.images.map((img, idx) => (
                      <div key={idx} style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', height: '120px', background: '#f1f5f9', border: '1px solid var(--border)' }}>
                        <img 
                          src={img} 
                          alt="" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                        />
                        <button
                          onClick={() => {
                            if (confirm("האם אתה בטוח שברצונך למחוק תמונה זו מהדשבורד של הספקים?")) {
                              deleteSupplierImage(selectedSupplierProfile["Real Phone"] || selectedSupplierProfile["Phone Number"], img);
                            }
                          }}
                          type="button"
                          style={{
                            position: 'absolute', top: '5px', left: '5px',
                            width: '22px', height: '22px', borderRadius: '50%',
                            background: 'rgba(239, 68, 68, 0.85)', color: 'white', border: 'none',
                            cursor: 'pointer', fontSize: '11px', fontWeight: '900',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'all 0.15s',
                            zIndex: 10
                          }}
                          title="מחק תמונה מהדשבורד"
                          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.background = '#ef4444'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.85)'; }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedSupplierProfile.reviews && selectedSupplierProfile.reviews.length > 0 && (
                <div style={{ marginBottom: '25px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '15px', color: 'var(--accent)' }}>⭐ ביקורות נבחרות</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedSupplierProfile.reviews.map((rev, idx) => (
                      <div key={idx} style={{ 
                        position: 'relative',
                        background: 'white', padding: '15px', borderRadius: '10px', 
                        border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' 
                      }}>
                        <button
                          onClick={() => {
                            if (confirm("האם אתה בטוח שברצונך למחוק חוות דעת זו?")) {
                              deleteSupplierReview(selectedSupplierProfile["Real Phone"] || selectedSupplierProfile["Phone Number"], idx);
                            }
                          }}
                          style={{
                            position: 'absolute', top: '12px', left: '12px',
                            background: 'none', border: 'none', color: '#ef4444',
                            cursor: 'pointer', fontSize: '14px', padding: '4px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: 0.6, transition: 'all 0.15s', zIndex: 5
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.transform = 'scale(1)'; }}
                          title="מחק חוות דעת"
                        >
                          ✕
                        </button>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', paddingLeft: '20px' }}>
                          <span style={{ fontWeight: 'bold' }}>{rev.reviewer}</span>
                          <span style={{ color: '#f59e0b' }}>{'⭐'.repeat(Math.min(5, Math.max(1, Math.round(Number(rev.rating) || 5))))}</span>
                        </div>
                        <p style={{ fontSize: '0.9rem', color: '#475569', margin: 0, paddingLeft: '20px' }}>"{rev.text}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Fiesta Push Modal ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showFiestaPushModal && fiestaPushSupplier && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 11000, padding: '20px'
            }}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0 }}
              className="glass-card"
              style={{ maxWidth: '520px', width: '100%', padding: '36px', textAlign: 'center' }}
              dir="rtl"
            >
              {fiestaPushResult === 'exists' ? (
                // ── Already Exists ──────────────────────────────────
                <>
                  <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>👋</div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: '900', marginBottom: '10px', color: 'var(--primary)' }}>
                    הספק כבר קיים!
                  </h2>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '8px', fontSize: '1rem' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong> כבר נמצא במאגר של Fiesta.
                  </p>
                  <p style={{ color: '#8b5cf6', fontWeight: '700', fontSize: '1rem', marginBottom: '28px' }}>
                    תודה רבה על המאמץ {activeAgent}! 💜
                  </p>
                  <button
                    onClick={handleCloseFiestaPushModal}
                    className="btn-primary"
                    style={{ width: '100%', padding: '14px' }}
                  >
                    סגור
                  </button>
                </>
              ) : fiestaPushResult === 'success' ? (
                // ── Success ────────────────────────────────────────
                <>
                  <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>🎉</div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: '900', marginBottom: '10px', color: '#10b981' }}>
                    הספק נשלח לפייסטה!
                  </h2>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '28px' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong> נוסף בהצלחה לאתר Fiesta. כל הכבוד {activeAgent}! 🚀
                  </p>
                  <button
                    onClick={handleCloseFiestaPushModal}
                    className="btn-primary"
                    style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, #10b981, #059669)' }}
                  >
                    מעולה, המשך
                  </button>
                </>
              ) : fiestaPushResult === 'error' ? (
                // ── Error ──────────────────────────────────────────
                <>
                  <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>⚠️</div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: '800', marginBottom: '10px', color: '#ef4444' }}>
                    שגיאה בשליחה לפייסטה
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '28px' }}>{fiestaPushError}</p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={submitToFiesta} className="btn-primary" style={{ flex: 1, padding: '12px' }}>נסה שוב</button>
                    <button onClick={handleCloseFiestaPushModal} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white' }}>סגור</button>
                  </div>
                </>
              ) : fiestaPushStep === 1 ? (
                // ── Step 1: Category Picker ─────────────────────────
                <>
                  {renderWizardHeader(1, "בחר קטגוריה")}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                    gap: '8px',
                    maxHeight: '40vh',
                    overflowY: 'auto',
                    paddingLeft: '4px',
                    marginBottom: '20px'
                  }}>
                    {FIESTA_CATEGORIES.map(cat => (
                      <button
                        key={cat.value}
                        onClick={() => {
                          setFiestaPushForm(f => ({ ...f, type: cat.value }));
                          setFiestaPushStep(2);
                        }}
                        style={{
                          padding: '12px 6px',
                          borderRadius: '12px',
                          border: fiestaPushForm.type === cat.value
                            ? '2px solid var(--accent)'
                            : '1.5px solid var(--border)',
                          background: fiestaPushForm.type === cat.value
                            ? 'var(--accent-soft)'
                            : 'white',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '5px',
                          transition: 'all 0.15s',
                          fontFamily: 'inherit'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f5f3ff'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = fiestaPushForm.type === cat.value ? 'var(--accent-soft)' : 'white';
                          e.currentTarget.style.borderColor = fiestaPushForm.type === cat.value ? 'var(--accent)' : 'var(--border)';
                        }}
                      >
                        <span style={{ fontSize: '1.5rem' }}>{cat.emoji}</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text)', textAlign: 'center', lineHeight: '1.2' }}>
                          {cat.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={handleSkipFiestaPush}
                      className="btn-primary"
                      style={{ flex: 1, padding: '12px', background: '#64748b' }}
                      title="דלג על העלאה לפייסטה ושמור רק בתוך CRM"
                    >
                      דלג (שמור ל-CRM)
                    </button>
                    <button
                      onClick={handleCloseFiestaPushModal}
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit' }}
                    >
                      ביטול
                    </button>
                  </div>
                </>
              ) : fiestaPushStep === 2 ? (
                // ── Step 2: Details Form ────────────────────────────
                <>
                  {renderWizardHeader(2, "פרטי העסק")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>

                  <div style={{ textAlign: 'right', display: 'grid', gap: '14px', marginBottom: '24px' }}>
                    {/* Type selection dropdown */}
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: '700', display: 'block', marginBottom: '5px' }}>קטגוריה באתר Fiesta</label>
                      <select
                        value={fiestaPushForm.type}
                        onChange={e => setFiestaPushForm(f => ({ ...f, type: e.target.value }))}
                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.95rem' }}
                      >
                        {FIESTA_CATEGORIES.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Description */}
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: '700', display: 'block', marginBottom: '5px' }}>תיאור קצר</label>
                      <textarea
                        value={fiestaPushForm.description}
                        onChange={e => setFiestaPushForm(f => ({ ...f, description: e.target.value }))}
                        rows={3}
                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem', resize: 'none', fontFamily: 'inherit' }}
                        placeholder="תיאור קצר של הספק..."
                      />
                    </div>

                    {/* Region */}
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: '700', display: 'block', marginBottom: '5px' }}>אזור</label>
                      <input
                        value={fiestaPushForm.region}
                        onChange={e => setFiestaPushForm(f => ({ ...f, region: e.target.value }))}
                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                        placeholder="לדוגמה: מרכז, תל אביב..."
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => setFiestaPushStep(3)}
                      className="btn-primary"
                      style={{ flex: 2, padding: '12px' }}
                    >
                      המשך
                    </button>
                    <button
                      onClick={() => setFiestaPushStep(1)}
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit' }}
                    >
                      חזור
                    </button>
                  </div>
                </>
              ) : fiestaPushStep === 3 ? (
                // ── Step 3: Pricing & Discounts ────────────────────────────
                <>
                  {renderWizardHeader(3, "תמחור ועמלות")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>

                  <div style={{ textAlign: 'right', display: 'grid', gap: '14px', marginBottom: '24px' }}>
                    {/* Row 1: Original price + Customer price */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '4px', color: '#666' }}>מחיר מחירון (₪)</label>
                        <input
                          type="number"
                          value={fiestaPushForm.originalPrice}
                          onChange={e => setFiestaPushForm(f => ({ ...f, originalPrice: e.target.value }))}
                          style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                          placeholder="מה הספק לוקח בשוק"
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '4px', color: '#666' }}>מחיר לקוח (₪)</label>
                        <input
                          type="number"
                          value={fiestaPushForm.price}
                          onChange={e => setFiestaPushForm(f => ({ ...f, price: e.target.value }))}
                          style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                          placeholder="מחיר מיוחד ללקוח"
                        />
                      </div>
                    </div>

                    {/* Auto-calculated discount preview */}
                    {fiestaPushForm.originalPrice && fiestaPushForm.price && parseFloat(fiestaPushForm.price) < parseFloat(fiestaPushForm.originalPrice) && (
                      <div style={{ background: '#dcfce7', borderRadius: '8px', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#166534' }}>
                          🏷️ הנחה אוטומטית:
                        </span>
                        <span style={{ fontWeight: '900', color: '#166534', fontSize: '0.95rem' }}>
                          {fiestaPushForm.discountDisplayType === 'percent'
                            ? `${Math.round((1 - parseFloat(fiestaPushForm.price) / parseFloat(fiestaPushForm.originalPrice)) * 100)}%`
                            : `₪${Math.round(parseFloat(fiestaPushForm.originalPrice) - parseFloat(fiestaPushForm.price))}`
                          }
                        </span>
                      </div>
                    )}

                    {/* Discount display type */}
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '6px', color: '#666' }}>איך להציג את ההנחה ללקוח?</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {[
                          { value: 'percent', label: '% אחוזים', emoji: '📊' },
                          { value: 'amount',  label: '₪ שקלים',  emoji: '💵' }
                        ].map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setFiestaPushForm(f => ({ ...f, discountDisplayType: opt.value }))}
                            style={{
                              flex: 1, padding: '9px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
                              fontWeight: '700', fontSize: '0.85rem', transition: 'all 0.15s',
                              border: fiestaPushForm.discountDisplayType === opt.value ? '2px solid #7c3aed' : '1.5px solid var(--border)',
                              background: fiestaPushForm.discountDisplayType === opt.value ? '#ede9fe' : 'white',
                              color: fiestaPushForm.discountDisplayType === opt.value ? '#7c3aed' : '#555'
                            }}
                          >
                            {opt.emoji} {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Company commission + Customer discount % */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '4px', color: '#666' }}>עמלת החברה (₪)</label>
                        <input
                          type="number"
                          value={fiestaPushForm.commissionAmount}
                          onChange={e => setFiestaPushForm(f => ({ ...f, commissionAmount: e.target.value }))}
                          style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                          placeholder="עמלה ל-Fiesta"
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '4px', color: '#166534' }}>הנחה ללקוח (%)</label>
                        <div style={{
                          padding: '9px', borderRadius: '8px', border: '2px solid #86efac',
                          background: '#f0fdf4', fontSize: '1rem', fontWeight: '900',
                          color: '#166534', textAlign: 'center'
                        }}>
                          {fiestaPushForm.originalPrice && fiestaPushForm.price && parseFloat(fiestaPushForm.originalPrice) > 0
                            ? `${Math.round((1 - parseFloat(fiestaPushForm.price || 0) / parseFloat(fiestaPushForm.originalPrice)) * 100)}%`
                            : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => setFiestaPushStep(4)}
                      className="btn-primary"
                      style={{ flex: 2, padding: '12px' }}
                    >
                      המשך
                    </button>
                    <button
                      onClick={() => setFiestaPushStep(2)}
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit' }}
                    >
                      חזור
                    </button>
                  </div>
                </>
              ) : fiestaPushStep === 4 ? (
                // ── Step 4: Contract Upload & Status ────────────────────────────
                <>
                  {renderWizardHeader(4, "העלאת חוזה או צילום שיחה")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>

                  <div style={{ textAlign: 'right', display: 'grid', gap: '14px', marginBottom: '24px' }}>
                    {/* Styled upload area */}
                    <div 
                      className="upload-zone"
                      onClick={() => document.getElementById(`modal-file-upload`).click()}
                      style={{ 
                        border: '2.5px dashed var(--border)',
                        borderRadius: '12px',
                        padding: '24px',
                        textAlign: 'center',
                        background: fiestaPushForm.agreementImage ? '#f0fdf4' : 'transparent',
                        borderColor: fiestaPushForm.agreementImage ? '#86efac' : 'var(--border)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <input 
                        id="modal-file-upload"
                        type="file" 
                        onChange={(e) => handleModalFileChange(e.target.files[0])}
                        style={{ display: 'none' }}
                        accept="image/*"
                      />
                      {fiestaPushForm.agreementImage ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <CheckCircle2 size={30} color="#16a34a" />
                          <span style={{ color: '#16a34a', fontWeight: '700', fontSize: '0.85rem' }}>חוזה / צילום מסך צורף בהצלחה!</span>
                          <div style={{ marginTop: '8px', width: '100%', height: '110px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #16a34a' }}>
                            <img src={fiestaPushForm.agreementImage} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFiestaPushForm(f => ({ ...f, agreementImage: '' }));
                            }}
                            style={{ background: '#ef4444', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', marginTop: '6px' }}
                          >
                            הסר תמונה
                          </button>
                        </div>
                      ) : (
                        <div style={{ color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '10px 0' }}>
                          <Upload size={32} />
                          <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>לחץ כאן להעלאת חוזה או צילום מסך מוואטסאפ</span>
                        </div>
                      )}
                    </div>

                    {/* Agreement signed checkbox */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem', marginTop: '8px' }}>
                      <input
                        type="checkbox"
                        checked={fiestaPushForm.agreementSigned}
                        onChange={e => setFiestaPushForm(f => ({ ...f, agreementSigned: e.target.checked }))}
                        style={{ width: '18px', height: '18px' }}
                      />
                      הסכם עבודה חתום ומאושר
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => setFiestaPushStep(5)}
                      className="btn-primary"
                      style={{ flex: 2, padding: '12px' }}
                    >
                      המשך
                    </button>
                    <button
                      onClick={() => setFiestaPushStep(3)}
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit' }}
                    >
                      חזור
                    </button>
                  </div>
                </>
              ) : fiestaPushStep === 5 ? (
                // ── Step 5: Portfolio Gallery Selection ────────────────────────────
                <>
                  {renderWizardHeader(5, "בחירת תמונות גלריה")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>

                  <div style={{ textAlign: 'right', marginBottom: '24px' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: '800', display: 'block', marginBottom: '8px', color: '#555' }}>
                      📷 תמונות גלריה שיועלו לאתר ({fiestaPushForm.selectedImages?.length || 0})
                    </label>
                    {fiestaPushForm.selectedImages && fiestaPushForm.selectedImages.length > 0 ? (
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(4, 1fr)', 
                        gap: '8px', 
                        background: '#f8fafc', 
                        padding: '12px', 
                        borderRadius: '10px', 
                        border: '1.5px solid var(--border)', 
                        maxHeight: '160px', 
                        overflowY: 'auto' 
                      }}>
                        {fiestaPushForm.selectedImages.map((imgUrl, idx) => (
                          <div 
                            key={idx} 
                            style={{ 
                              position: 'relative', 
                              width: '100%', 
                              aspectRatio: '1', 
                              borderRadius: '8px', 
                              overflow: 'hidden', 
                              border: '1px solid var(--border)'
                            }}
                          >
                            <img 
                              src={imgUrl} 
                              alt={`img-${idx}`} 
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                            <button
                              onClick={() => {
                                setFiestaPushForm(f => ({
                                  ...f,
                                  selectedImages: f.selectedImages.filter(url => url !== imgUrl)
                                }));
                              }}
                              type="button"
                              style={{
                                position: 'absolute', top: '3px', left: '3px',
                                width: '18px', height: '18px', borderRadius: '50%',
                                background: '#ef4444', color: 'white', border: 'none',
                                cursor: 'pointer', fontSize: '9px', fontWeight: '900',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                              }}
                              title="הסר תמונה"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ 
                        padding: '12px', 
                        textAlign: 'center', 
                        background: '#fff1f2', 
                        border: '1.5px dashed #fecdd3', 
                        color: '#e11d48', 
                        borderRadius: '10px', 
                        fontSize: '0.8rem', 
                        fontWeight: '700' 
                      }}>
                        ⚠️ לא נבחרו תמונות. האתר יציג תמונת ברירת מחדל.
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => setFiestaPushStep(6)}
                      className="btn-primary"
                      style={{ flex: 2, padding: '12px' }}
                    >
                      המשך
                    </button>
                    <button
                      onClick={() => setFiestaPushStep(4)}
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit' }}
                    >
                      חזור
                    </button>
                  </div>
                </>
              ) : (
                // ── Step 6: Confirmation & Submit ────────────────────────────
                <>
                  {renderWizardHeader(6, "אישור ושליחה")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>

                  <div style={{ 
                    textAlign: 'right', 
                    background: '#f8fafc', 
                    padding: '16px', 
                    borderRadius: '12px', 
                    border: '1px solid var(--border)', 
                    display: 'grid', 
                    gap: '8px', 
                    fontSize: '0.88rem', 
                    marginBottom: '20px',
                    lineHeight: '1.4'
                  }}>
                    <div><strong>ספק:</strong> {fiestaPushSupplier['Supplier Name']}</div>
                    <div><strong>קטגוריה פייסטה:</strong> {FIESTA_CATEGORIES.find(c => c.value === fiestaPushForm.type)?.label || fiestaPushForm.type}</div>
                    <div><strong>אזור:</strong> {fiestaPushForm.region || 'לא צוין'}</div>
                    {fiestaPushForm.price && <div><strong>מחיר ללקוח:</strong> ₪{fiestaPushForm.price} {fiestaPushForm.originalPrice && `(מחירון: ₪${fiestaPushForm.originalPrice})`}</div>}
                    <div><strong>עמלת חברה:</strong> ₪{fiestaPushForm.commissionAmount || '0'}</div>
                    <div><strong>חוזה/שיחה:</strong> {fiestaPushForm.agreementImage ? '✅ צורף' : '❌ לא צורף'}</div>
                    <div><strong>חתימת חוזה:</strong> {fiestaPushForm.agreementSigned ? '✍️ חתום' : '⏳ טרם נחתם'}</div>
                    <div><strong>תמונות גלריה:</strong> {fiestaPushForm.selectedImages?.length || 0} תמונות נבחרו</div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={submitToFiesta}
                      disabled={fiestaPushLoading}
                      className="btn-primary"
                      style={{ flex: 2, padding: '14px', opacity: fiestaPushLoading ? 0.7 : 1 }}
                    >
                      {fiestaPushLoading ? '⏳ שולח לפייסטה...' : '🚀 שלח לפייסטה'}
                    </button>
                    <button
                      onClick={() => setFiestaPushStep(5)}
                      disabled={fiestaPushLoading}
                      style={{ flex: 1, padding: '14px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit' }}
                    >
                      חזור
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer style={{ marginTop: '60px', textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <p>&copy; {new Date().getFullYear()} Fiesta Admin Dashboard</p>
      </footer>

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
