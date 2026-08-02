'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, MessageCircle, Phone, Calendar, CheckCircle2, User, LogOut, Search, Image as ImageIcon, Globe, ExternalLink, FileText, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supplierMatchesSearch } from '../lib/searchUtils';
import {
  clearSession,
  getSupplierPhone,
  loadSession,
  loadUiState,
  saveSession,
  saveUiState,
} from '../lib/agentSession';
import { phoneKey, getSupplierState } from '../lib/phoneUtils';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import {
  collectLocalMedia,
  extractInstagramUrls,
  extractWebsiteUrl,
  getGoogleImageUrl,
  pickBestStoredImage,
  supplierHasDisplayImage,
  shouldRejectLoadedImage,
  getNextImageCandidate,
} from '../lib/supplierImageSources';
import {
  appendActivityLog,
  buildActivityEntry,
  countAgentCalls,
  DAY_MS,
  getManagerStats,
  resolveActivityAction,
  WEEK_MS,
} from '../lib/agentActivity';
import {
  loadAllSupplierStatesLocal,
  saveAllSupplierStatesLocal,
  saveSupplierStateLocal,
} from '../lib/supplierStateStorage';
import {
  mapCategoryToFiesta,
  buildDefaultDescription,
  extractRegionFromAddress,
} from '../lib/fiestaCategoryMap';
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
  const [activeTab, setActiveTab] = useState('לא נגעו בכלל');
  const [showReminderSuccess, setShowReminderSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [selectedSupplierProfile, setSelectedSupplierProfile] = useState(null);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescriptionText, setEditedDescriptionText] = useState('');
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [apiHealthWarning, setApiHealthWarning] = useState(null);
  const [statesLoadWarning, setStatesLoadWarning] = useState(null);
  const [supplierImages, setSupplierImages] = useState({}); // phone → imageUrl | 'loading' | 'error'
  const [fetchingAllImages, setFetchingAllImages] = useState(false);
  const [imageFetchProgress, setImageFetchProgress] = useState({ done: 0, total: 0 });
  const [sessionRestored, setSessionRestored] = useState(false);
  const pendingRestoreRef = useRef({ scrollY: null, selectedPhone: null });
  const scrollSaveTimerRef = useRef(null);
  const assignmentsSyncedRef = useRef(false);
  const supplierStatesRef = useRef({});
  const [moveEffects, setMoveEffects] = useState({});
  const [exitingSuppliers, setExitingSuppliers] = useState({});
  const [activeMoveButton, setActiveMoveButton] = useState(null);

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
    { value: 'venue',             label: 'אולמות וגנים' },
    { value: 'dj',                label: 'DJ ומוזיקה' },
    { value: 'photographer',      label: 'צילום אירועים' },
    { value: 'design',            label: 'עיצוב אירועים' },
    { value: 'catering',          label: 'קייטרינג' },
    { value: 'makeup',            label: 'איפור' },
    { value: 'dresses',           label: 'שמלות כלה' },
    { value: 'suits',             label: 'חליפות חתן' },
    { value: 'hair',              label: 'עיצוב שיער' },
    { value: 'bar',               label: 'שירותי בר' },
    { value: 'alcohol',           label: 'אלכוהול ובר' },
    { value: 'rings',             label: 'טבעות נישואין' },
    { value: 'transportation',    label: 'הסעות' },
    { value: 'cars',              label: 'רכבי יוקרה' },
    { value: 'singers',           label: 'זמרים ולהקות' },
    { value: 'attractions',       label: 'אטרקציות' },
    { value: 'event-production',  label: 'הפקת אירועים' },
    { value: 'invitations',       label: 'הזמנות' },
    { value: 'rabbi',             label: 'רב לחופה' },
    { value: 'cantors',           label: 'חזנים ופייטנים' },
    { value: 'religious-bands',   label: 'להקות דתיות' },
    { value: 'challa',            label: 'הפרשת חלה' },
    { value: 'hotels',            label: 'מלונות' },
    { value: 'getting-ready',     label: 'התארגנות כלה' },
    { value: 'bachelor',          label: 'מסיבות רווקים' },
    { value: 'souvenirs',         label: 'מזכרות' },
    { value: 'bride-shoes',       label: 'נעלי כלה' },
    { value: 'groom-shoes',       label: 'נעלי חתן' },
    { value: 'equipment-rental',  label: 'השכרת ציוד' },
    { value: 'rsvp',              label: 'אישורי הגעה' },
    { value: 'dietitians',        label: 'תזונה ודיאטה' },
    { value: 'personal-training', label: 'כושר ואימון' },
  ];
  
  // Categories mapping
  const agentCategoryMap = {
    'ינון': ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל', 'photographer'],
    'מורן': [
      'מאפרות', 'איפור', 'שיער', 'כלות', 'לחתן ולכלה',
      'שמלות כלה', 'חליפות חתן', 'makeup', 'hair', 'dresses', 'suits',
    ],
    'הודיה': [], // פיד ריק — כל קטגוריות הכלה/איפור/שיער/שמלות עברו למורן
    'נתנאל': [] // Sees all
  };

  const moranGroupOrder = ['dress', 'makeup', 'hair', 'suit', 'other'];
  const moranGroupLabels = {
    dress: 'שמלות כלה',
    makeup: 'איפור',
    hair: 'שיער',
    suit: 'חליפות חתן',
    other: 'אחר',
  };
  const supplierIndexByPhone = useMemo(() => {
    const map = new Map();
    suppliers.forEach((s, index) => {
      const key = phoneKey(s['Real Phone'] || s.phone);
      if (key) map.set(key, index + 1);
    });
    return map;
  }, [suppliers]);

  const stateFor = (phone) => getSupplierState(supplierStates, phone);

  const getMoranSupplierGroup = (supplier) => {
    const text = [
      supplier['Supplier Name'],
      supplier.name,
      supplier.clean_name,
      supplier.description,
    ].filter(Boolean).join(' ').toLowerCase();

    const rules = [
      ['dress', ['שמלות כלה', 'שמלה', 'bridal dresses', 'bridal', 'bride\'s', 'brides', 'gown', 'שמלות']],
      ['makeup', ['מאפר', 'איפור', 'makeup', 'mua']],
      ['hair', ['מסרק', 'תסרוק', 'עיצוב שיער', 'שיער', 'hair style', 'hair', 'braids', 'צמות']],
      ['suit', ['חליפות חתן', 'חליפת חתן', 'חליפות בוטיק', ' suit']],
    ];

    for (const [group, keywords] of rules) {
      if (keywords.some((kw) => text.includes(kw))) return group;
    }
    return 'other';
  };

  const buildDisplayList = (list, agent, query) => {
    if (agent !== 'מורן' || query) {
      return list.map((supplier) => ({ type: 'supplier', supplier }));
    }

    const grouped = { dress: [], makeup: [], hair: [], suit: [], other: [] };
    list.forEach((supplier) => {
      grouped[getMoranSupplierGroup(supplier)].push(supplier);
    });

    moranGroupOrder.forEach((group) => {
      grouped[group].sort((a, b) =>
        (a['Supplier Name'] || '').localeCompare(b['Supplier Name'] || '', 'he')
      );
    });

    const display = [];
    moranGroupOrder.forEach((group) => {
      if (!grouped[group].length) return;
      display.push({
        type: 'header',
        group,
        label: moranGroupLabels[group],
        count: grouped[group].length,
      });
      grouped[group].forEach((supplier) => {
        display.push({ type: 'supplier', supplier, moranGroup: group });
      });
    });
    return display;
  };

  const isSupplierTouched = (state = {}) => {
    if (!state) return false;
    if (state.status) return true;
    if (state.callbackScheduled) return true;
    if (state.reminder) return true;
    if (state.notes && String(state.notes).trim()) return true;
    if (state.uploadedImage) return true;
    if (state.firstTouchedAt) return true;
    return false;
  };

  const supplierBelongsToAgent = (supplier, agent) => {
    if (agent === 'נתנאל' || agent === 'מאגר כללי') return true;
    if (agent === 'הודיה') return false;
    const allowedCategories = agentCategoryMap[agent] || [];
    if (supplier.Category === 'ספקים ללא קטגוריה' || !supplier.Category) return true;
    return allowedCategories.some((cat) => supplier.Category.includes(cat));
  };

  const getAgentFeedSuppliers = (agent) => {
    if (!agent || agent === 'נתנאל' || agent === 'מאגר כללי' || agent === 'הודיה') return [];
    return suppliers.filter((supplier) => {
      if (!supplierBelongsToAgent(supplier, agent)) return false;
      if (agent === 'מורן' && getMoranSupplierGroup(supplier) === 'other') return false;
      const name = (supplier['Supplier Name'] || supplier.clean_name || '').trim();
      const phone = supplier['Real Phone'] || supplier.phone || '';
      return name && name !== 'ספק ללא שם' && phone && phone !== 'FAILED' && phone !== 'N/A';
    });
  };

  const getAgentFeedStats = (agent) => {
    const feed = getAgentFeedSuppliers(agent);
    let touched = 0;
    feed.forEach((supplier) => {
      const phone = supplier['Real Phone'] || supplier.phone;
      if (isSupplierTouched(stateFor(phone))) touched += 1;
    });
    return { total: feed.length, touched, untouched: feed.length - touched };
  };

  const buildAgentAssignments = (agent) => {
    return getAgentFeedSuppliers(agent).map((supplier) => {
      const phone = supplier['Real Phone'] || supplier.phone;
      const moranGroup = agent === 'מורן' ? getMoranSupplierGroup(supplier) : '';
      return {
        phone,
        assignedAgent: agent,
        moranGroup,
        assignedCategory: agent === 'מורן'
          ? moranGroupLabels[moranGroup]
          : (supplier.Category || 'כללי'),
        supplierName: supplier['Supplier Name'] || supplier.clean_name || '',
      };
    });
  };

  const persistUiForAgent = (agent, overrides = {}) => {
    if (!agent) return;
    saveUiState(agent, {
      activeTab,
      searchQuery,
      scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
      selectedPhone: getSupplierPhone(selectedSupplierProfile),
      ...overrides,
    });
  };

  const persistUiMetaForAgent = (agent) => {
    if (!agent) return;
    saveUiState(agent, {
      activeTab,
      searchQuery,
      selectedPhone: getSupplierPhone(selectedSupplierProfile),
    });
  };

  const persistFullUiSnapshot = (agent) => {
    if (!agent || typeof window === 'undefined') return;
    saveUiState(agent, {
      activeTab,
      searchQuery,
      scrollY: window.scrollY,
      selectedPhone: getSupplierPhone(selectedSupplierProfile),
    });
  };

  const restoreScrollPosition = (scrollY, selectedPhone) => {
    const tryScroll = () => {
      if (typeof scrollY === 'number') {
        window.scrollTo({ top: scrollY, behavior: 'auto' });
      }
      if (selectedPhone) {
        const el = document.querySelector(`[data-supplier-phone="${CSS.escape(selectedPhone)}"]`);
        el?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    };

    tryScroll();
    requestAnimationFrame(tryScroll);
    setTimeout(tryScroll, 150);
    setTimeout(tryScroll, 500);
  };

  const applyUiState = (ui) => {
    if (!ui) {
      setActiveTab('לא נגעו בכלל');
      setSearchQuery('');
      setSelectedSupplierProfile(null);
      pendingRestoreRef.current = { scrollY: null, selectedPhone: null };
      return;
    }
    const restoredTab = ui.activeTab === 'לטיפול' ? 'לא נגעו בכלל' : (ui.activeTab || 'לא נגעו בכלל');
    setActiveTab(restoredTab);
    setSearchQuery(ui.searchQuery || '');
    setSelectedSupplierProfile(null);
    pendingRestoreRef.current = {
      scrollY: typeof ui.scrollY === 'number' ? ui.scrollY : null,
      selectedPhone: ui.selectedPhone || null,
    };
  };

  const handleAgentSwitch = (agent) => {
    if (activeAgent && activeAgent !== agent) {
      persistUiForAgent(activeAgent);
    }
    assignmentsSyncedRef.current = false;
    setActiveAgent(agent);
    saveSession(agent);
    applyUiState(loadUiState(agent));
  };

  useEffect(() => {
    const session = loadSession();
    if (session) {
      setActiveAgent(session.agent);
      setIsLoggedIn(true);
      saveSession(session.agent);
      applyUiState(loadUiState(session.agent));
    }
    setSessionRestored(true);
  }, []);

  useEffect(() => {
    supplierStatesRef.current = supplierStates;
  }, [supplierStates]);

  useEffect(() => {
    if (!isLoggedIn || !activeAgent || loading) return;
    persistUiMetaForAgent(activeAgent);
  }, [activeTab, searchQuery, selectedSupplierProfile, isLoggedIn, activeAgent, loading]);

  useEffect(() => {
    if (!isLoggedIn || !activeAgent) return;

    const saveScrollPosition = () => {
      saveUiState(activeAgent, { scrollY: window.scrollY });
    };

    const saveBeforeLeave = () => {
      if (activeAgent) persistFullUiSnapshot(activeAgent);
      saveAllSupplierStatesLocal(supplierStatesRef.current);
    };

    const onScroll = () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = setTimeout(saveScrollPosition, 250);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveBeforeLeave();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', saveBeforeLeave);
    window.addEventListener('beforeunload', saveBeforeLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', saveBeforeLeave);
      window.removeEventListener('beforeunload', saveBeforeLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isLoggedIn, activeAgent, activeTab, searchQuery, selectedSupplierProfile]);

  useEffect(() => {
    if (!isLoggedIn || !activeAgent || loading) return;

    const { selectedPhone, scrollY } = pendingRestoreRef.current;

    if (selectedPhone) {
      const restoredProfile = suppliers.find((s) => getSupplierPhone(s) === selectedPhone) || null;
      if (restoredProfile) setSelectedSupplierProfile(restoredProfile);
    }

    pendingRestoreRef.current = { scrollY: null, selectedPhone: null };

    if (typeof scrollY === 'number' || selectedPhone) {
      restoreScrollPosition(scrollY, selectedPhone);
    }
  }, [loading, suppliers, isLoggedIn, activeAgent]);

  useEffect(() => {
    fetch('/api/suppliers?lite=1', { cache: 'no-store' })
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

        const suspiciouslySmall = data.length > 0 && data.length < 200;
        if ((source !== 'json' && source !== 'mongodb') || emptyInPayload > 5 || suspiciouslySmall) {
          setApiHealthWarning(
            `השרת מריץ גרסה ישנה (${data.length} רשומות, מקור: ${source || 'לא ידוע'}). רענן את הדף — אם נמשך, redeploy ב-Vercel.`
          );
        } else {
          setApiHealthWarning(null);
        }

        const normalizeRow = (s) => {
          const category = s.Category || s.category || '';
          const supplierName = (s['Supplier Name'] || s.name || s.Name || s.clean_name || '').trim();
          const cleanName = (s.clean_name || supplierName.split('|')[0]?.trim() || supplierName).trim();
          const realPhone = s['Real Phone'] || s.real_phone || s.phone || s['Phone Number'] || '';
          return {
            ...s,
            id: s.id ?? null,
            clean_name: cleanName,
            'Supplier Name': supplierName || cleanName || 'ספק ללא שם',
            'Real Phone': realPhone,
            phone: realPhone,
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

        const localStates = loadAllSupplierStatesLocal();

        fetch('/api/states', { cache: 'no-store' })
          .then(async (res) => {
            let savedStates = {};
            if (res.ok) {
              savedStates = await res.json();
              if (savedStates?.error) {
                setStatesLoadWarning('לא הצלחנו לטעון סטטוסים מהענן — מוצגים רק נתונים מקומיים. רענון עשוי לעזור.');
                savedStates = {};
              } else {
                setStatesLoadWarning(null);
              }
            } else {
              setStatesLoadWarning('שגיאה בטעינת סטטוסים מהענן — ייתכן שחלק מהעבודה לא יוצג. נסי לרענן.');
              savedStates = {};
            }

            const mergedStates = { ...localStates };
            for (const [key, state] of Object.entries(savedStates)) {
              const nk = phoneKey(key);
              if (!nk) continue;
              mergedStates[nk] = { ...(mergedStates[nk] || {}), ...state };
            }

            setSupplierStates(mergedStates);
            saveAllSupplierStatesLocal(mergedStates);
            setLoading(false);
          })
          .catch(() => {
            setStatesLoadWarning('שגיאת רשת בטעינת סטטוסים — מוצגים נתונים מקומיים בלבד.');
            setSupplierStates({ ...localStates });
            setLoading(false);
          });
      })
      .catch(err => {
        console.error(err);
        setApiHealthWarning('לא ניתן להתחבר לשרת. ודא ש-npm run dev רץ על פורט 3000.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!isLoggedIn || loading || !suppliers.length) return;
    if (!activeAgent || activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי' || activeAgent === 'הודיה') return;
    if (assignmentsSyncedRef.current) return;

    const assignments = buildAgentAssignments(activeAgent);
    if (!assignments.length) return;

    fetch('/api/states/sync-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;
        assignmentsSyncedRef.current = true;
        setSupplierStates((prev) => {
          const next = { ...prev };
          assignments.forEach((item) => {
            const key = phoneKey(item.phone);
            next[key] = {
              ...(next[key] || {}),
              assignedAgent: item.assignedAgent,
              assignedCategory: item.assignedCategory,
              moranGroup: item.moranGroup,
              supplierName: item.supplierName,
            };
          });
          return next;
        });
      })
      .catch((err) => console.error('Assignment sync failed:', err));
  }, [isLoggedIn, loading, suppliers, activeAgent]);

  // Persistent callback reminder checker running every 5 seconds
  useEffect(() => {
    if (!isLoggedIn || !activeAgent) return;

    const checkReminders = () => {
      const now = Date.now();
      const newAlerts = [];
      const allowedCategories = agentCategoryMap[activeAgent] || [];

      suppliers.forEach((s, index) => {
        const phone = s["Real Phone"] || s["phone"];
        const state = stateFor(phone);
        if (!state || Object.keys(state).length === 0) return;

        // Condition for active, non-dismissed callback reminder
        if (state.callbackTimestamp && now >= state.callbackTimestamp && state.callbackDismissed !== true) {
          
          // Check if this supplier belongs to the active agent
          let isAllowed = false;
          if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') {
            isAllowed = true;
          } else if (activeAgent === 'הודיה') {
            isAllowed = false;
          } else {
            if (s.Category === "ספקים ללא קטגוריה" || !s.Category) {
              isAllowed = true;
            } else {
              const matches = allowedCategories.some(cat => s.Category.includes(cat));
              if (matches) {
                isAllowed = true;
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
                new Notification(`תזכורת - ${s['Supplier Name']}`, {
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

  const supplierHasHttpImage = (supplier) => supplierHasDisplayImage(supplier);

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
    return pickBestStoredImage(supplier);
  };

  const handleSupplierImageLoad = (supplier, e) => {
    const phone = supplier['Real Phone'] || supplier.phone || '';
    const img = e.currentTarget;
    if (!shouldRejectLoadedImage(img.naturalWidth, img.naturalHeight)) return;

    const srcAttr = img.getAttribute('src') || '';
    let current = srcAttr;
    try {
      const abs = new URL(img.src, window.location.origin);
      current = abs.pathname.startsWith('/media/') ? abs.pathname : srcAttr;
    } catch {
      current = srcAttr;
    }

    const next = getNextImageCandidate(supplier, current);
    if (!next || next === current) {
      if (img.parentElement) img.parentElement.style.display = 'none';
      return;
    }

    setSupplierImages((prev) => ({ ...prev, [phone]: next }));
    applyImageToSupplier(phone, next);
  };

  const fetchImageForSupplier = async (supplier) => {
    const phone = supplier['Real Phone'] || supplier.phone || '';
    if (!phone) return null;

    const existing = pickBestStoredImage(supplier);
    if (existing) {
      if (String(existing).startsWith('http')) {
        setSupplierImages((prev) => ({ ...prev, [phone]: existing }));
      }
      return existing;
    }

    if (supplierImages[phone] === 'loading') return null;
    if (supplierImages[phone] && supplierImages[phone] !== 'error') return supplierImages[phone];

    const googleImage = getGoogleImageUrl(supplier) || '';
    const instagram = extractInstagramUrls(supplier).join('|');
    const website = extractWebsiteUrl(supplier) || '';
    const engagedUrl = getEngagedUrl(supplier) || '';

    if (!googleImage && !instagram && !website && !engagedUrl) return null;

    setSupplierImages((prev) => ({ ...prev, [phone]: 'loading' }));
    try {
      const params = new URLSearchParams({ phone });
      if (googleImage) params.set('googleImage', googleImage);
      if (instagram) params.set('instagram', instagram);
      if (website) params.set('website', website);
      if (engagedUrl) params.set('url', engagedUrl);

      const res = await fetch(`/api/fetch-supplier-image?${params.toString()}`);
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
              images: [
                imageUrl,
                ...collectLocalMedia(supplier),
                ...(supplier.images || []).filter((i) => !String(i).startsWith('http')),
              ],
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
      const best = pickBestStoredImage(s);
      if (best && String(best).startsWith('http')) seeded[phone] = best;
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

  // ── Trigger Fiesta Push Modal ─────────────────────────────────────────────
  const collectPushImages = (supplier, cachedImg) => {
    const pushImages = [];
    const add = (img) => {
      if (!img || img === 'N/A' || img === 'nan') return;
      const value = String(img).trim();
      if (!value) return;
      if (value.startsWith('http') || value.startsWith('/media/') || value.startsWith('data:image/')) {
        if (!pushImages.includes(value)) pushImages.push(value);
      }
    };

    if (cachedImg) add(cachedImg);
    (supplier.images || []).forEach(add);
    add(supplier['Main Image']);
    add(supplier['Google Image'] || supplier.google_image);
    if (supplier['Gallery'] && supplier['Gallery'] !== 'N/A' && supplier['Gallery'] !== 'nan') {
      String(supplier['Gallery']).split(/[,|]/).forEach(add);
    }
    (supplier.portfolio || []).forEach((item) => add(typeof item === 'string' ? item : item?.image));
    return pushImages;
  };

  const triggerFiestaPush = (supplier, targetStatus = null) => {
    const mappedType = mapCategoryToFiesta(supplier.Category || supplier.category, supplier);
    const address = supplier['Address'] || supplier.address || '';
    const region = extractRegionFromAddress(address);

    const phone = supplier['Real Phone'] || supplier['phone'] || '';
    const cachedImg = phone && typeof supplierImages[phone] === 'string' && supplierImages[phone].startsWith('http')
      ? supplierImages[phone] : null;

    const pushImages = collectPushImages(supplier, cachedImg);

    const state = stateFor(phone);
    const rawUploaded = state?.uploadedImage || '';
    const uploadedImage = rawUploaded && rawUploaded !== '[stored]' ? rawUploaded : '';
    const isSigned = targetStatus ? (targetStatus === 'contract') : (state ? (state.status === 'contract') : false);

    setFiestaPushSupplier(supplier);
    setFiestaPushResult(null);
    setFiestaPushError('');
    setFiestaPushStep(1);
    setFiestaPushForm({
      type: mappedType,
      description: buildDefaultDescription(supplier),
      region,
      originalPrice: '',
      price: '',
      agentCommission: '',
      commissionAmount: '',
      discountDisplayType: 'percent',
      agreementSigned: isSigned,
      selectedImages: pushImages,
      agreementImage: uploadedImage,
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
            images: (fiestaPushForm.selectedImages || fiestaPushForm.images || fiestaPushSupplier?.images || []).filter(
              (img) => {
                const s = String(img || '').trim();
                return (
                  s.startsWith('http://') ||
                  s.startsWith('https://') ||
                  s.startsWith('/media/') ||
                  s.startsWith('data:image/')
                );
              }
            ),
            reviews: Array.isArray(fiestaPushForm.reviews)
              ? fiestaPushForm.reviews
              : Array.isArray(fiestaPushSupplier?.reviews)
                ? fiestaPushSupplier.reviews
                : Array.isArray(fiestaPushSupplier?.reviews?.reviews)
                  ? fiestaPushSupplier.reviews.reviews
                  : [],
          }
        })
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        setFiestaPushResult('error');
        setFiestaPushError(
          `תשובה לא תקינה מהשרת (HTTP ${res.status}): ${raw.slice(0, 180) || 'ריק'}`
        );
        return;
      }
      if (!res.ok || data.error) {
        setFiestaPushResult('error');
        setFiestaPushError(data.error || `שגיאה מהשרת (HTTP ${res.status})`);
        return;
      }

      // success / updated / exists — CRM status must still be saved
      if (data.success || data.updated || data.exists) {
        setFiestaPushResult(data.exists && !data.updated && !data.success ? 'exists' : 'success');

        const phone = fiestaPushSupplier['Real Phone'] || fiestaPushSupplier['phone'] || '';
        const statusToSave = pendingStatusChange
          ? pendingStatusChange.status
          : (fiestaPushForm.agreementSigned ? 'contract' : 'not-signed');

        const agreementToSave =
          fiestaPushForm.agreementImage && fiestaPushForm.agreementImage !== '[stored]'
            ? fiestaPushForm.agreementImage
            : undefined;

        updateSupplierState(phone, {
          status: statusToSave,
          reminder: null,
          agent: activeAgent,
          ...(agreementToSave ? { uploadedImage: agreementToSave } : {}),
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

        <h2 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--primary)', margin: 0 }}>
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
    const updatedReviews = (Array.isArray(supplier.reviews) ? supplier.reviews : []).filter((_, idx) => idx !== reviewIdx);
    
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
    const key = phoneKey(phone);
    if (!key) return;

    const touchFields = ['status', 'callbackScheduled', 'reminder', 'notes', 'uploadedImage'];
    const isTouchAction = touchFields.some((field) => field in newState);
    const enrichedState = { ...newState };
    const prevState = supplierStates[key] || {};

    if (isTouchAction) {
      enrichedState.lastTouchedAt = Date.now();
      enrichedState.lastTouchedBy = activeAgent;
      if (!prevState.firstTouchedAt) {
        enrichedState.firstTouchedAt = Date.now();
        enrichedState.firstTouchedBy = activeAgent;
      }

      const activityAction = resolveActivityAction(newState);
      if (activityAction && activeAgent) {
        enrichedState.activityLog = appendActivityLog(
          prevState.activityLog,
          buildActivityEntry(activityAction.action, activeAgent, activityAction)
        );
      }

      if (activeAgent === 'מורן' || activeAgent === 'ינון') {
        const supplier = suppliers.find((s) => phoneKey(s['Real Phone'] || s.phone) === key);
        if (supplier) {
          enrichedState.assignedAgent = activeAgent;
          enrichedState.supplierName = supplier['Supplier Name'] || supplier.clean_name || '';
          if (activeAgent === 'מורן') {
            const group = getMoranSupplierGroup(supplier);
            enrichedState.moranGroup = group;
            enrichedState.assignedCategory = moranGroupLabels[group];
          } else {
            enrichedState.assignedCategory = supplier.Category || 'כללי';
          }
        }
      }
    }

    setSupplierStates((prev) => {
      const merged = { ...(prev[key] || {}), ...enrichedState };
      saveSupplierStateLocal(phone, merged);
      return {
        ...prev,
        [key]: merged,
      };
    });
    fetch('/api/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, state: enrichedState }),
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
    
    const applyCallback = () => {
      updateSupplierState(phone, {
        callbackScheduled: timeStr,
        callbackTimestamp: reminderTime.getTime(),
        callbackDismissed: false,
        callbackEmailSent: false,
        agent: activeAgent,
      });
      setActiveCallbackPicker(null);
    };

    triggerSupplierMove(phone, 'callback', `${phone}-callback`, applyCallback);
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
    
    const applyCustomCallback = () => {
      updateSupplierState(phone, {
        callbackScheduled: timeStr,
        callbackTimestamp: reminderTime.getTime(),
        callbackDismissed: false,
        callbackEmailSent: false,
        agent: activeAgent,
      });
      setActiveCallbackPicker(null);
    };

    triggerSupplierMove(phone, 'callback', `${phone}-callback`, applyCustomCallback);
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
      saveSession(agent);
      applyUiState(loadUiState(agent));
      if ('Notification' in window) Notification.requestPermission();
    } else {
      setLoginError(true);
    }
  };

  const handleLogout = () => {
    if (activeAgent) persistUiForAgent(activeAgent);
    saveAllSupplierStatesLocal(supplierStatesRef.current);
    clearSession();
    setIsLoggedIn(false);
    setPassword('');
  };

  const updateSupplierCategory = (index, newCategory) => {
    const updatedSuppliers = [...suppliers];
    updatedSuppliers[index].Category = newCategory;
    setSuppliers(updatedSuppliers);
  };

  if (!sessionRestored) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', padding: '20px', dir: 'rtl'
      }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>טוען...</div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="login-screen" dir="rtl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="login-card"
        >
          <h1 className="logo">FIESTA</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '28px', fontSize: '0.95rem' }}>
            מערכת ניהול ספקים · כניסת מורשים
          </p>

          <div style={{ marginBottom: '22px' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: '700', marginBottom: '10px', color: 'var(--text)' }}>
              בחר פרופיל כניסה
            </p>
            <div className="login-agent-grid">
              {['ינון', 'מורן', 'הודיה', 'נתנאל', 'מאגר כללי'].map(agent => (
                <button
                  key={agent}
                  type="button"
                  onClick={() => setActiveAgent(agent)}
                  className={`login-agent-btn${activeAgent === agent ? ' active' : ''}`}
                >
                  {agent}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <input
              type="password"
              placeholder="הכנס סיסמה"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  activeAgent ? handleLogin(activeAgent) : alert('בחר סוכן קודם');
                }
              }}
              className="login-input"
            />
            {loginError && (
              <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '8px' }}>
                סיסמה שגויה, נסה שוב
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => activeAgent ? handleLogin(activeAgent) : alert('בחר סוכן קודם')}
            className="btn-primary"
            style={{ width: '100%', padding: '14px' }}
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
    updateSupplierState(phone, { showDatePicker: !stateFor(phone).showDatePicker });
  };

  const MOVE_META = {
    'not-interested': { tab: 'טופלו', label: 'לא מעוניין', color: '#ef4444' },
    'not-available': { tab: 'לא ענו', label: 'לא ענו', color: '#f97316' },
    'not-signed': { tab: 'עדיין לא חתם', label: 'עדיין לא חתם', color: '#3b82f6' },
    'reset-untouched': { tab: 'לא נגעו בכלל', label: 'לא נגעו בכלל', color: '#ef4444' },
    callback: { tab: 'לחזור אליהם', label: 'לחזור אליהם', color: '#0ea5e9' },
  };

  const triggerSupplierMove = (phone, metaKey, buttonKey, applyAction) => {
    const meta = MOVE_META[metaKey];
    if (!meta) {
      applyAction();
      return;
    }

    if (buttonKey) {
      setActiveMoveButton(buttonKey);
      setTimeout(() => setActiveMoveButton(null), 350);
    }

    applyAction();

    setExitingSuppliers((prev) => ({ ...prev, [phone]: { fromTab: activeTab } }));
    setMoveEffects((prev) => ({ ...prev, [phone]: { ...meta, phase: 'flash' } }));

    setTimeout(() => {
      setMoveEffects((prev) => ({ ...prev, [phone]: { ...meta, phase: 'exit' } }));
      setTimeout(() => {
        setMoveEffects((prev) => {
          const next = { ...prev };
          delete next[phone];
          return next;
        });
        setExitingSuppliers((prev) => {
          const next = { ...prev };
          delete next[phone];
          return next;
        });
      }, 360);
    }, 280);
  };

  const resetSupplierToUntouched = (phone) => {
    const prevState = stateFor(phone);
    const resetState = {
      status: null,
      reminder: null,
      callbackScheduled: null,
      callbackTimestamp: null,
      callbackDismissed: null,
      callbackEmailSent: null,
      notes: '',
      uploadedImage: null,
      firstTouchedAt: null,
      firstTouchedBy: null,
      lastTouchedAt: null,
      lastTouchedBy: null,
      agent: null,
    };

    if (activeAgent) {
      resetState.activityLog = appendActivityLog(
        prevState.activityLog,
        buildActivityEntry('reset', activeAgent, { from: 'not-signed', to: 'untouched' })
      );
    }

    setSupplierStates((prev) => {
      const merged = { ...prev[phone], ...resetState };
      saveSupplierStateLocal(phone, merged);
      return { ...prev, [phone]: merged };
    });

    fetch('/api/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, state: resetState }),
    }).catch((err) => console.error('Reset save error:', err));
  };

  const setStatus = (phone, status) => {
    if (status === 'contract') {
      const supplier = suppliers.find(s => (s['Real Phone'] || s['phone']) === phone);
      if (supplier) {
        setPendingStatusChange({ phone, status });
        triggerFiestaPush(supplier, status);
      }
      return;
    }

    const isReset = status === 'not-signed' && stateFor(phone).status === 'not-signed';
    const metaKey = isReset
      ? 'reset-untouched'
      : status === 'not-interested'
        ? 'not-interested'
        : status === 'not-available'
          ? 'not-available'
          : status === 'not-signed'
            ? 'not-signed'
            : null;

    const apply = () => {
      if (isReset) {
        resetSupplierToUntouched(phone);
      } else {
        updateSupplierState(phone, { status, reminder: null, agent: activeAgent });
      }
    };

    triggerSupplierMove(phone, metaKey, `${phone}-${status}`, apply);
  };

  const setReminder = (phone, timeText) => {
    updateSupplierState(phone, { reminder: timeText, agent: activeAgent });
  };

  const addToCalendar = (phone, supplier, overrideReminder = null) => {
    const state = stateFor(phone);
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
    const state = stateFor(phone);
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

  const renderManagerStats = () => {
    const stats = getManagerStats(supplierStates, ['ינון', 'מורן', 'הודיה']);

    const renderStatRow = (label, data, accent) => (
      <div style={{ marginBottom: '12px' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: '800', color: accent, marginBottom: '6px' }}>{label}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          <div className="stat-cell">
            <p style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--success)', margin: 0 }}>{data.closed}</p>
            <p style={{ fontSize: '0.65rem', fontWeight: '700', color: 'var(--text-muted)', margin: 0 }}>סגירות</p>
          </div>
          <div className="stat-cell">
            <p style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--warning)', margin: 0 }}>{data.noAnswer}</p>
            <p style={{ fontSize: '0.65rem', fontWeight: '700', color: 'var(--text-muted)', margin: 0 }}>לא ענו</p>
          </div>
          <div className="stat-cell">
            <p style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--info)', margin: 0 }}>{data.notSigned}</p>
            <p style={{ fontSize: '0.65rem', fontWeight: '700', color: 'var(--text-muted)', margin: 0 }}>לא חתמו</p>
          </div>
          <div className="stat-cell">
            <p style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--primary)', margin: 0 }}>{data.total}</p>
            <p style={{ fontSize: '0.65rem', fontWeight: '700', color: 'var(--text-muted)', margin: 0 }}>פעולות</p>
          </div>
        </div>
      </div>
    );

    return (
      <div style={{ marginBottom: '40px' }} className="animate-in">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '800', margin: 0, color: 'var(--primary)' }}>סיכום ביצועים - מבט מנהל</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>מתעדכן בזמן אמת · יומי = 24 שעות אחרונות</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          {['ינון', 'מורן', 'הודיה'].map(agent => (
            <div key={agent} className="glass-card" style={{ borderTop: '4px solid var(--accent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <div style={{ width: '40px', height: '40px', background: 'var(--accent-soft)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <User size={24} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: '800' }}>סוכן: {agent}</h3>
              </div>

              {renderStatRow('היום (24 שעות)', stats[agent].today, 'var(--accent-strong)')}
              {renderStatRow('השבוע (7 ימים)', stats[agent].week, '#2563eb')}
              {renderStatRow('סה"כ מצטבר', stats[agent].all, '#64748b')}

              {agent !== 'הודיה' && (
                <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  כיסוי פיד: <strong style={{ color: '#10b981' }}>{getAgentFeedStats(agent).touched}</strong>
                  {' / '}
                  {getAgentFeedStats(agent).total}
                  {' · '}
                  לא נגעו: <strong style={{ color: '#ef4444' }}>{getAgentFeedStats(agent).untouched}</strong>
                </div>
              )}
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
            background: 'var(--card-bg)',
            border: '2px solid var(--border)'
          }}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--accent-strong)' }}>
              תודה רבה לאישה הטובה והיפה בעולם
            </h3>
          </div>
        </div>
      );
    }

    const moranBanner = activeAgent === 'מורן' ? (
      <div className="glass-card" style={{
        padding: '28px 24px',
        marginBottom: '20px',
        textAlign: 'center',
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
      }}>
        <p style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--accent)', marginBottom: '8px', letterSpacing: '0.05em' }}>
          מורן
        </p>
        <h3 style={{
          fontSize: '1.55rem',
          fontWeight: '800',
          lineHeight: 1.45,
          color: 'var(--primary)',
          
          margin: 0,
        }}>
          אישה חזקה שכמותך — תביאי לי מלא לידיים!
        </h3>
        <p style={{ fontSize: '0.95rem', color: '#6b7280', marginTop: '10px', fontWeight: '600' }}>
          אני יודע שאת יכולה. תתחילי לרוץ!
        </p>
      </div>
    ) : null;

    const feedStats = (activeAgent === 'מורן' || activeAgent === 'ינון')
      ? getAgentFeedStats(activeAgent)
      : null;

    const feedStatsCard = feedStats ? (
      <div className="glass-card" style={{
        padding: '18px 20px',
        marginBottom: '20px',
        border: '1px solid var(--border)',
        background: 'var(--card-bg)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: '800', color: 'var(--primary)' }}>
              מעקב כיסוי פיד
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569' }}>
              {feedStats.touched} טופלו · {feedStats.untouched} עדיין לא נגעו · {feedStats.total} סה"כ
            </p>
          </div>
          <button
            onClick={() => setActiveTab('לא נגעו בכלל')}
            style={{
              padding: '10px 16px',
              borderRadius: '12px',
              border: 'none',
              background: feedStats.untouched > 0 ? '#ef4444' : '#10b981',
              color: 'white',
              fontWeight: '800',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {feedStats.untouched > 0 ? `הצג שלא נגעו (${feedStats.untouched})` : 'כיסית את כל הפיד'}
          </button>
        </div>
      </div>
    ) : null;

    const dailyTarget = activeAgent === 'מורן' ? 7 : 50;
    const weeklyTarget = activeAgent === 'מורן' ? 35 : 250;

    const callsToday = countAgentCalls(supplierStates, activeAgent, DAY_MS);
    const callsThisWeek = countAgentCalls(supplierStates, activeAgent, WEEK_MS);

    const dailyRemaining = Math.max(0, dailyTarget - callsToday);
    const dailyProgress = Math.min(100, (callsToday / dailyTarget) * 100);
    const weeklyProgress = Math.min(100, (callsThisWeek / weeklyTarget) * 100);

    return (
      <div style={{ marginBottom: '30px' }} className="animate-in">
        {moranBanner}
        {feedStatsCard}
        <div className="glass-card" style={{ padding: '20px', borderRight: '6px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '800' }}>היעד היומי שלך (24 שעות)</h3>
              {activeAgent === 'מורן' && dailyRemaining > 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: '700' }}>שימי לב מורן, נשארו עוד {dailyRemaining} שיחות כדי להגיע ליעד!</p>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>נשארו עוד {dailyRemaining} שיחות ליעד היום</p>
              )}
            </div>
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--accent)' }}>{callsToday}</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}> / {dailyTarget}</span>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div style={{ width: '100%', height: '10px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${dailyProgress}%` }}
              style={{ height: '100%', background: 'var(--accent)', borderRadius: '10px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '0.75rem', fontWeight: '700' }}>
            <span style={{ color: 'var(--text-muted)' }}>יעד שבועי: {callsThisWeek} / {weeklyTarget} ({Math.round(weeklyProgress)}%)</span>
            <span style={{ color: dailyProgress === 100 ? '#10b981' : 'var(--accent)' }}>
              {dailyProgress === 100 ? 'היעד הושלם' : `${Math.round(dailyProgress)}% הושלם`}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const supplierMatchesAgentFeed = (supplier) => {
    if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') return true;
    if (activeAgent === 'הודיה') return false;
    const allowedCategories = agentCategoryMap[activeAgent] || [];
    if (supplier.Category === 'ספקים ללא קטגוריה' || !supplier.Category) return true;
    return allowedCategories.some((cat) => supplier.Category.includes(cat));
  };

  const getTabCounts = () => {
    const counts = {
      'לא נגעו בכלל': 0,
      'לחזור אליהם': 0,
      'לא ענו': 0,
      'עדיין לא חתם': 0,
      'טופלו': 0,
    };

    suppliers.forEach((supplier) => {
      if (!supplierMatchesAgentFeed(supplier)) return;
      if (activeAgent === 'מורן' && getMoranSupplierGroup(supplier) === 'other') return;

      const name = (supplier['Supplier Name'] || supplier.clean_name || '').trim();
      const phone = supplier['Real Phone'] || supplier.phone || '';
      if (!name || name === 'ספק ללא שם' || !phone || phone === 'FAILED' || phone === 'N/A') return;

      const tab = getSupplierTab(phone);
      if (tab && counts[tab] !== undefined) counts[tab] += 1;
    });

    return counts;
  };

  const getSupplierTab = (phone) => {
    const state = stateFor(phone);
    const isHandled = state.status === 'not-interested' || state.status === 'contract';
    const isCallback = !!state.callbackScheduled || state.status === 'thinking' || state.status === 'no-answer';

    if (!isSupplierTouched(state)) return 'לא נגעו בכלל';
    if (state.status === 'not-available') return 'לא ענו';
    if (state.status === 'not-signed') return 'עדיין לא חתם';
    if (isHandled) return 'טופלו';
    if (isCallback) return 'לחזור אליהם';
    return null;
  };

  const filteredSuppliers = suppliers
    .filter((s) => {
      if (debouncedSearchQuery) return true;

      if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') return true;
      if (activeAgent === 'הודיה') return false;
      const allowedCategories = agentCategoryMap[activeAgent] || [];

      if (s.Category === 'ספקים ללא קטגוריה' || !s.Category) return true;

      return allowedCategories.some((cat) => s.Category.includes(cat));
    })
    .filter((s) => {
      if (debouncedSearchQuery) return true;

      const phone = s['Real Phone'] || s.phone;
      const exitInfo = exitingSuppliers[phone];
      if (exitInfo?.fromTab === activeTab) return true;

      const state = stateFor(phone);
      const isHandled = state.status === 'not-interested' || state.status === 'contract';
      const isCallback = !!state.callbackScheduled || state.status === 'thinking' || state.status === 'no-answer';

      if (activeTab === 'לא נגעו בכלל') {
        return !isSupplierTouched(state);
      }

      if (state.status === 'not-available') {
        return activeTab === 'לא ענו';
      }
      if (state.status === 'not-signed') {
        return activeTab === 'עדיין לא חתם';
      }

      if (activeTab === 'לחזור אליהם') return !isHandled && isCallback;
      if (activeTab === 'לא ענו') return false;
      if (activeTab === 'עדיין לא חתם') return false;
      return isHandled;
    })
    .filter((s) => {
      if (!debouncedSearchQuery) return true;
      const key = phoneKey(s['Real Phone'] || s.phone);
      const supplierNumber = key ? supplierIndexByPhone.get(key) : null;
      return supplierMatchesSearch(s, debouncedSearchQuery, supplierNumber);
    })
    .filter((s) => {
      const name = (s['Supplier Name'] || s.clean_name || '').trim();
      const phone = s['Real Phone'] || s.phone || '';
      return name && name !== 'ספק ללא שם' && phone && phone !== 'FAILED' && phone !== 'N/A';
    })
    .filter((s) => {
      if (activeAgent !== 'מורן' || debouncedSearchQuery) return true;
      return getMoranSupplierGroup(s) !== 'other';
    });

  const displaySuppliers = filteredSuppliers;
  const displayList = buildDisplayList(filteredSuppliers, activeAgent, debouncedSearchQuery);
  const tabCounts = getTabCounts();

  const openSupplierProfile = async (supplier) => {
    setSelectedSupplierProfile(supplier);
    const phone = supplier['Real Phone'] || supplier.phone;
    if (!phone || !supplier.lite) return;

    try {
      const res = await fetch(`/api/suppliers?phone=${encodeURIComponent(phone)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const full = await res.json();
      setSelectedSupplierProfile(full);
      setSuppliers((prev) =>
        prev.map((s) =>
          phoneKey(s['Real Phone'] || s.phone) === phoneKey(phone)
            ? { ...s, ...full, lite: false }
            : s
        )
      );
    } catch (err) {
      console.error('Failed to load full supplier profile:', err);
    }
  };

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
          {apiHealthWarning}
        </div>
      )}
      {statesLoadWarning && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 9998,
          background: '#92400e',
          color: '#fff',
          padding: '12px 16px',
          textAlign: 'center',
          fontSize: '0.95rem',
          fontWeight: 600,
          borderBottom: '2px solid #f59e0b',
        }}>
          {statesLoadWarning}
        </div>
      )}
      {activeAgent === 'נתנאל' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'transparent',
          zIndex: -1
        }} />
      )}
      {/* Unified app header */}
      <header className="top-header animate-in">
        {/* Menorah watermark — Hanukkah motif */}
        <svg
          className="top-header-menorah"
          viewBox="0 0 160 140"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* flames */}
          <path d="M80 8c0 6-4 10-4 14a4 4 0 108 0c0-4-4-8-4-14z" fill="currentColor" opacity="0.95" />
          <path d="M52 18c0 5-3.2 8-3.2 11.5a3.2 3.2 0 106.4 0c0-3.5-3.2-6.5-3.2-11.5z" fill="currentColor" opacity="0.75" />
          <path d="M108 18c0 5-3.2 8-3.2 11.5a3.2 3.2 0 106.4 0c0-3.5-3.2-6.5-3.2-11.5z" fill="currentColor" opacity="0.75" />
          <path d="M28 30c0 4.2-2.6 6.8-2.6 9.8a2.6 2.6 0 105.2 0c0-3-2.6-5.6-2.6-9.8z" fill="currentColor" opacity="0.55" />
          <path d="M132 30c0 4.2-2.6 6.8-2.6 9.8a2.6 2.6 0 105.2 0c0-3-2.6-5.6-2.6-9.8z" fill="currentColor" opacity="0.55" />
          <path d="M12 44c0 3.5-2 5.6-2 8.2a2 2 0 104 0c0-2.6-2-4.7-2-8.2z" fill="currentColor" opacity="0.4" />
          <path d="M148 44c0 3.5-2 5.6-2 8.2a2 2 0 104 0c0-2.6-2-4.7-2-8.2z" fill="currentColor" opacity="0.4" />
          <path d="M40 40c0 3.5-2 5.6-2 8.2a2 2 0 104 0c0-2.6-2-4.7-2-8.2z" fill="currentColor" opacity="0.45" />
          <path d="M120 40c0 3.5-2 5.6-2 8.2a2 2 0 104 0c0-2.6-2-4.7-2-8.2z" fill="currentColor" opacity="0.45" />
          {/* cups */}
          <path d="M74 28h12v4H74zM46 38h12v3.5H46zM102 38h12v3.5h-12zM22 50h12v3H22zM126 50h12v3h-12zM6 58h12v2.5H6zM142 58h12v2.5h-12zM34 54h12v2.5H34zM114 54h12v2.5h-12z" fill="currentColor" />
          {/* arms */}
          <path d="M80 32v52M52 41.5c0 18 12 28 28 28M108 41.5c0 18-12 28-28 28M28 53c0 14 20 24.5 52 24.5M132 53c0 14-20 24.5-52 24.5M12 60.5c0 10 24 20.5 68 20.5M148 60.5c0 10-24 20.5-68 20.5M40 56.5c0 12 16 21.5 40 21.5M120 56.5c0 12-16 21.5-40 21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          {/* stem + base */}
          <path d="M80 84v28" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M58 112h44M64 118h32M70 124h20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <ellipse cx="80" cy="128" rx="18" ry="3" fill="currentColor" opacity="0.35" />
        </svg>
        <div className="top-header-glow" aria-hidden="true" />

        <div className="top-header-inner">
          <div className="top-header-brand">
            <div className="logo-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 6h16v3.2H14.2V14H22v3.1H14.2V26H8V6z" fill="currentColor" />
                <circle cx="24.5" cy="8.5" r="2.2" fill="currentColor" opacity="0.85" />
              </svg>
            </div>
            <div className="top-header-brand-text">
              <h1 className="top-header-title">FIESTA</h1>
              <div className="top-header-meta">
                <p className="top-header-welcome">שלום {activeAgent}</p>
                <span className="top-header-meta-divider" aria-hidden="true" />
                <span className="top-header-goal">
                  <span className="top-header-goal-label">יעד</span>
                  <span className="top-header-goal-value">חנוכה</span>
                </span>
              </div>
            </div>
          </div>

          <div className="top-header-actions">
            <div className="agent-switcher">
              {['ינון', 'מורן', 'הודיה', 'נתנאל', 'מאגר כללי'].map(agent => (
                <button
                  key={agent}
                  type="button"
                  onClick={() => handleAgentSwitch(agent)}
                  className={activeAgent === agent ? 'active' : ''}
                >
                  {agent}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="top-header-logout"
              title="יציאה"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
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
              <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.12em', color: 'var(--accent)', marginBottom: '16px' }}>CLOSED</div>
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
              background: 'var(--success)',
              color: 'white',
              padding: '16px 24px',
              borderRadius: '10px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
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
                background: 'var(--primary)',
                color: 'white', 
                padding: '16px', 
                borderRadius: '10px', 
                display: 'flex', 
                flexDirection: 'column',
                gap: '12px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
                borderRight: '4px solid var(--accent)',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <motion.div 
                    animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                    transition={{ repeat: Infinity, duration: 2, repeatDelay: 2 }}
                    style={{ fontSize: '1.5rem' }}
                  >
                    <Calendar size={18} />
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

      {activeAgent === 'נתנאל' && renderManagerStats()}
      {renderAgentTargets()}

      {activeAgent && activeAgent !== 'נתנאל' && activeAgent !== 'מאגר כללי' && (
        <div className="tab-bar">
          {[
            { key: 'לא נגעו בכלל', label: 'לא נגעו', count: tabCounts['לא נגעו בכלל'] },
            { key: 'לחזור אליהם', label: 'לחזור', count: tabCounts['לחזור אליהם'] },
            { key: 'לא ענו', label: 'לא ענו', count: tabCounts['לא ענו'] },
            { key: 'עדיין לא חתם', label: 'לא חתם', count: tabCounts['עדיין לא חתם'] },
            { key: 'טופלו', label: 'טופלו', count: tabCounts['טופלו'] },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`tab-btn${activeTab === tab.key ? ' active' : ''}`}
              title={tab.key}
            >
              {tab.label}
              <span className="tab-count">{tab.count}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-muted)' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }}></div>
          טוען ספקים...
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="search-row animate-in">
            <span className="search-icon">
              <Search size={18} />
            </span>
            <input
              type="text"
              placeholder="חפש ספק לפי שם, טלפון או מספר ספק (#)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="נקה חיפוש"
              >
                ✕
              </button>
            )}
          </div>

          {searchQuery && (
            <div className="search-hint animate-in">
              <span>
                נמצאו {displaySuppliers.length} תוצאות עבור &quot;{searchQuery}&quot; (מכל הלשוניות)
              </span>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-strong)',
                  fontWeight: '800',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontFamily: 'inherit',
                }}
              >
                בטל חיפוש
              </button>
            </div>
          )}

          {/* Fetch All Images Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={fetchAllSupplierImages}
              disabled={fetchingAllImages}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: 'none',
                background: fetchingAllImages ? 'var(--border)' : 'var(--primary)',
                color: fetchingAllImages ? 'var(--text-muted)' : 'white',
                fontWeight: '700', cursor: fetchingAllImages ? 'default' : 'pointer',
                fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px',
                fontFamily: 'inherit',
              }}
            >
              <ImageIcon size={16} />
              {fetchingAllImages
                ? `טוען תמונות... ${imageFetchProgress.done}/${imageFetchProgress.total}`
                : 'טען תמונות לכל הספקים'}
            </button>
            {imageFetchProgress.total > 0 && !fetchingAllImages && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {imageFetchProgress.done} תמונות נטענו
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
                background: 'var(--card-bg)',
                borderRadius: 'var(--radius)',
                border: '1px dashed var(--border)',
                width: '100%'
              }}>
                
                <h3 style={{ fontSize: '1.15rem', fontWeight: '800', marginBottom: '8px', color: 'var(--primary)' }}>לא נמצאו ספקים תואמים</h3>
                <p style={{ fontSize: '0.9rem' }}>נסה לחפש לפי שם אחר, מספר טלפון מלא או מספר ספק תקין.</p>
              </div>
            ) : (
              displayList.map((item) => {
                if (item.type === 'header') {
                  return (
                    <div
                      key={`moran-header-${item.group}`}
                      style={{
                        gridColumn: '1 / -1',
                        marginTop: item.group === 'dress' ? '0' : '28px',
                        marginBottom: '12px',
                        padding: '16px 20px',
                        borderRadius: '14px',
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                      }}
                    >
                      <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: 'var(--accent-strong)' }}>
                        {item.label}
                      </h3>
                      <span style={{
                        fontSize: '0.8rem',
                        fontWeight: '800',
                        color: 'var(--accent-strong)',
                        background: 'white',
                        padding: '6px 12px',
                        borderRadius: '999px',
                        border: '1px solid var(--border)',
                      }}>
                        {item.count} ספקים
                      </span>
                    </div>
                  );
                }

                const s = item.supplier;
                const phone = s["Real Phone"] || s["phone"];
                const state = stateFor(phone);
                const supplierNumber = supplierIndexByPhone.get(phoneKey(phone)) || suppliers.indexOf(s) + 1;
                const cardKey = `${s.id ?? 'no-id'}-${phone}-${supplierNumber}`;
                const supplierTab = getSupplierTab(phone);
                const moveFx = moveEffects[phone];

                return (
                  <motion.div 
                    key={cardKey}
                    data-supplier-phone={phone}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={
                      moveFx?.phase === 'exit'
                        ? { opacity: 0, scale: 0.94 }
                        : { opacity: 1, scale: 1 }
                    }
                    transition={
                      moveFx?.phase === 'exit'
                        ? { duration: 0.36, ease: [0.4, 0, 0.2, 1] }
                        : { duration: 0.25 }
                    }
                    className="supplier-card"
                    style={{ 
                      position: 'relative',
                      '--move-color': moveFx?.color || 'transparent',
                      borderRight: moveFx?.phase === 'flash'
                        ? `4px solid ${moveFx.color}`
                        : state.status === 'not-interested' ? '4px solid #ef4444' :
                          state.status === 'not-available' ? '4px solid #f97316' : 
                          state.status === 'contract' ? '4px solid #10b981' : 
                          state.status === 'not-signed' ? '4px solid #3b82f6' : 
                          state.callbackScheduled ? '4px solid #0ea5e9' : undefined,
                      boxShadow: moveFx?.phase === 'flash'
                        ? `0 0 0 3px ${moveFx.color}33`
                        : undefined,
                    }}
                  >
                    <AnimatePresence>
                      {moveFx && (moveFx.phase === 'flash' || moveFx.phase === 'exit') && (
                        <motion.span
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          style={{
                            position: 'absolute',
                            top: '10px',
                            left: '10px',
                            zIndex: 8,
                            background: moveFx.color,
                            color: 'white',
                            padding: '4px 10px',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: '800',
                            pointerEvents: 'none',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                          }}
                        >
                          → {moveFx.tab}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {(() => {
                      const imgUrl = getSupplierImage(s);
                      const isLoading = supplierImages[phone] === 'loading';
                      if (imgUrl) {
                        return (
                          <div className="supplier-media">
                            <span className="supplier-num">#{supplierNumber}</span>
                            <img
                              src={imgUrl}
                              alt={s['Supplier Name'] || ''}
                              onLoad={(e) => handleSupplierImageLoad(s, e)}
                              onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                            />
                          </div>
                        );
                      }
                      if (isLoading) {
                        return (
                          <div className="supplier-media-loading" style={{ position: 'relative' }}>
                            <span className="supplier-num">#{supplierNumber}</span>
                          </div>
                        );
                      }
                      return (
                        <div
                          className="supplier-media-empty"
                          onClick={() => fetchImageForSupplier(s)}
                          title="לחץ לטעינת תמונה"
                        >
                          <span className="supplier-num">#{supplierNumber}</span>
                          <ImageIcon size={16} />
                          טען תמונה
                        </div>
                      );
                    })()}

                    <div className="supplier-card-body">
                      <div className="supplier-card-top">
                        <div className="supplier-card-tags">
                          <span className="category-tag">
                            {activeAgent === 'מורן' && !searchQuery
                              ? moranGroupLabels[item.moranGroup || getMoranSupplierGroup(s)]
                              : (s['Category'] || 'כללי')}
                          </span>
                          {state.status === 'contract' && <span className="status-pill contract">נחתם</span>}
                          {state.status === 'not-interested' && <span className="status-pill not-interested">לא מעוניין</span>}
                          {state.status === 'not-available' && <span className="status-pill not-available">לא ענו</span>}
                          {state.status === 'not-signed' && <span className="status-pill not-signed">לא חתם</span>}
                          {state.callbackScheduled && !['contract', 'not-interested'].includes(state.status) && (
                            <span className="status-pill callback">לחזור</span>
                          )}
                          {searchQuery && supplierTab !== activeTab && (
                            <span className="category-tag">{supplierTab}</span>
                          )}
                        </div>
                        <div
                          className="date-trigger"
                          onClick={() => toggleDatePicker(phone)}
                        >
                          <Calendar size={14} />
                          <span>{state.closingDate || 'תאריך'}</span>
                        </div>
                      </div>

                      {state.reminder && (
                        <div style={{
                          fontSize: '0.75rem', color: 'var(--accent-strong)', background: 'var(--accent-soft)',
                          padding: '6px 10px', borderRadius: '8px', fontWeight: '700',
                          border: '1px solid rgba(138, 109, 69, 0.2)', display: 'flex', alignItems: 'center', gap: '6px',
                          marginBottom: '10px'
                        }}>
                          <Calendar size={13} />
                          <span>תזכורת: {state.reminder}</span>
                        </div>
                      )}

                      <h3 className="supplier-card-name">
                        {s['Supplier Name'] || s.clean_name || 'ספק ללא שם'}
                      </h3>
                      <p className="supplier-card-address">{s['Address'] || 'מיקום לא צוין'}</p>

                      <div className="supplier-card-meta-row">
                        {s['Google Rating'] && parseFloat(s['Google Rating']) > 0 && parseFloat(s['Google Rating']) <= 10 && (
                          <div className="rating-badge">
                            <Star size={13} color="#c9a227" fill="#c9a227" />
                            <span>{parseFloat(s['Google Rating']).toFixed(1)}</span>
                            {s['Reviews Count'] && parseInt(s['Reviews Count']) > 0 && (
                              <span style={{ color: 'var(--text-muted)', fontWeight: '500', fontSize: '0.75rem' }}>
                                ({s['Reviews Count']})
                              </span>
                            )}
                          </div>
                        )}
                        {s['Google Reviews Link'] && (
                          <a
                            href={s['Google Reviews Link'].startsWith('http') ? s['Google Reviews Link'] : `https://${s['Google Reviews Link']}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="meta-chip"
                          >
                            <ExternalLink size={12} />
                            ביקורות
                          </a>
                        )}
                        {s['Website'] && (
                          <a
                            href={s['Website'].startsWith('http') ? s['Website'] : `https://${s['Website']}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="meta-chip"
                          >
                            <Globe size={12} />
                            אתר
                          </a>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => openSupplierProfile(s)}
                        className="btn-profile"
                      >
                        <FileText size={16} />
                        הצג פרופיל מורחב
                      </button>
                    </div>

                    <div className="supplier-card-footer">
                      <textarea
                        className="supplier-notes"
                        placeholder="הערות לדיווח..."
                        value={state.notes || ''}
                        onChange={(e) => updateSupplierState(phone, { notes: e.target.value })}
                      />

                      <div className="card-actions-grid">
                        <button
                          type="button"
                          onClick={() => setStatus(phone, 'contract')}
                          className={`status-btn success${state.status === 'contract' ? ' active' : ''}`}
                        >
                          נחתם חוזה
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus(phone, 'not-interested')}
                          className={`status-btn danger${state.status === 'not-interested' ? ' active' : ''}${activeMoveButton === `${phone}-not-interested` ? ' supplier-move-btn-active' : ''}`}
                        >
                          לא מעוניין
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus(phone, 'not-available')}
                          className={`status-btn warning${state.status === 'not-available' ? ' active' : ''}${activeMoveButton === `${phone}-not-available` ? ' supplier-move-btn-active' : ''}`}
                        >
                          לא ענו
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus(phone, 'not-signed')}
                          title={state.status === 'not-signed' ? 'לחץ שוב להחזיר ללא נגעו בכלל' : 'סמן כעדיין לא חתם'}
                          className={`status-btn info${state.status === 'not-signed' ? ' active' : ''}${activeMoveButton === `${phone}-not-signed` ? ' supplier-move-btn-active' : ''}`}
                        >
                          עדיין לא חתם
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveCallbackPicker(activeCallbackPicker === phone ? null : phone)}
                          className={`status-btn callback${state.callbackScheduled || activeCallbackPicker === phone ? ' active' : ''}`}
                        >
                          {state.callbackScheduled ? state.callbackScheduled : 'לחזור מאוחר יותר'}
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
                            <p style={{ fontSize: '0.75rem', fontWeight: '800', color: '#0369a1', marginBottom: '10px' }}>בחר שעה לחזרה לספק:</p>
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
                              <p style={{ fontSize: '0.75rem', fontWeight: '800', color: '#0369a1', marginBottom: '8px' }}>או בחר מועד מותאם אישית:</p>
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

                      <div style={{ marginTop: state.status === 'closed' ? '8px' : '0' }}>
                        <a href={`tel:${s["Real Phone"]}`} className="btn-call">
                          <Phone size={18} />
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
                    onLoad={(e) => handleSupplierImageLoad(selectedSupplierProfile, e)}
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
                    background: 'var(--primary)',
                    color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px',
                    fontSize: '0.95rem', fontWeight: '800', cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)', transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.18)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.12)'; }}
                >
                  העלה לפייסטה
                </button>
              </div>

              <div style={{ marginBottom: '25px', background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '800', color: 'var(--accent)', margin: 0 }}>אודות העסק</h3>
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
                      ערוך תיאור
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
                          background: 'var(--success)', color: 'white', border: 'none',
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
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '15px', color: 'var(--accent)' }}>תמונות גלריה</h3>
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
                            cursor: 'pointer', fontSize: '11px', fontWeight: '800',
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

              {Array.isArray(selectedSupplierProfile.reviews) && selectedSupplierProfile.reviews.length > 0 && (
                <div style={{ marginBottom: '25px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '15px', color: 'var(--accent)' }}>ביקורות נבחרות</h3>
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
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.12em', color: 'var(--accent)', marginBottom: '16px' }}>קיים במערכת</div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: '800', marginBottom: '10px', color: 'var(--primary)' }}>
                    הספק כבר קיים!
                  </h2>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '8px', fontSize: '1rem' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong> כבר נמצא במאגר של Fiesta.
                  </p>
                  <p style={{ color: 'var(--accent)', fontWeight: '700', fontSize: '1rem', marginBottom: '28px' }}>
                    תודה רבה על המאמץ {activeAgent}
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
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.12em', color: 'var(--success)', marginBottom: '16px' }}>הצלחה</div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: '800', marginBottom: '10px', color: '#10b981' }}>
                    הספק נשלח לפייסטה!
                  </h2>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '28px' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong> נוסף בהצלחה לאתר Fiesta. כל הכבוד {activeAgent}
                  </p>
                  <button
                    onClick={handleCloseFiestaPushModal}
                    className="btn-primary"
                    style={{ width: '100%', padding: '14px', background: 'var(--success)' }}
                  >
                    מעולה, המשך
                  </button>
                </>
              ) : fiestaPushResult === 'error' ? (
                // ── Error ──────────────────────────────────────────
                <>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.12em', color: 'var(--danger)', marginBottom: '16px' }}>שגיאה</div>
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
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = fiestaPushForm.type === cat.value ? 'var(--accent-soft)' : 'white';
                          e.currentTarget.style.borderColor = fiestaPushForm.type === cat.value ? 'var(--accent)' : 'var(--border)';
                        }}
                      >
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
                          הנחה אוטומטית:
                        </span>
                        <span style={{ fontWeight: '800', color: '#166534', fontSize: '0.95rem' }}>
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
                          { value: 'percent', label: '% אחוזים' },
                          { value: 'amount',  label: '₪ שקלים' }
                        ].map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setFiestaPushForm(f => ({ ...f, discountDisplayType: opt.value }))}
                            style={{
                              flex: 1, padding: '9px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
                              fontWeight: '700', fontSize: '0.85rem', transition: 'all 0.15s',
                              border: fiestaPushForm.discountDisplayType === opt.value ? '2px solid var(--accent-strong)' : '1.5px solid var(--border)',
                              background: fiestaPushForm.discountDisplayType === opt.value ? 'var(--accent-soft)' : 'white',
                              color: fiestaPushForm.discountDisplayType === opt.value ? 'var(--accent-strong)' : '#555'
                            }}
                          >
                            {opt.label}
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
                          background: '#f0fdf4', fontSize: '1rem', fontWeight: '800',
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
                      תמונות גלריה שיועלו לאתר ({fiestaPushForm.selectedImages?.length || 0})
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
                        maxHeight: '220px', 
                        overflowY: 'auto' 
                      }}>
                        {fiestaPushForm.selectedImages.map((imgUrl, idx) => (
                          <div 
                            key={`${idx}-${String(imgUrl).slice(0, 24)}`} 
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
                              onError={(e) => { e.currentTarget.style.opacity = '0.25'; }}
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
                                cursor: 'pointer', fontSize: '9px', fontWeight: '800',
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
                        לא נבחרו תמונות. האתר יציג תמונת ברירת מחדל.
                      </div>
                    )}

                    <label
                      style={{
                        marginTop: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '12px',
                        borderRadius: '10px',
                        border: '1.5px dashed var(--accent)',
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-strong)',
                        fontWeight: '800',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                      }}
                    >
                      <Upload size={16} />
                      הוסף תמונות לגלריה
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (!files.length) return;
                          files.forEach((file) => {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              const dataUrl = reader.result;
                              if (!dataUrl) return;
                              setFiestaPushForm((f) => ({
                                ...f,
                                selectedImages: [...(f.selectedImages || []), dataUrl],
                              }));
                            };
                            reader.readAsDataURL(file);
                          });
                          e.target.value = '';
                        }}
                      />
                    </label>
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
                    <div><strong>תיאור:</strong> {(fiestaPushForm.description || '').slice(0, 120) || 'אין'}{(fiestaPushForm.description || '').length > 120 ? '…' : ''}</div>
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
                      {fiestaPushLoading ? 'שולח לפייסטה...' : 'שלח לפייסטה'}
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
