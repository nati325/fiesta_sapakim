'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, MessageCircle, Phone, Calendar, CheckCircle2, User, LogOut, Search, Image as ImageIcon, Globe, ExternalLink, FileText, Star, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  clearSession,
  getSupplierPhone,
  dismissWeeklySummary,
  isWeeklySummaryDismissed,
  loadSession,
  loadUiState,
  saveSession,
  saveUiState,
} from '../lib/agentSession';
import { phoneKey, getSupplierState, whatsappChatUrl } from '../lib/phoneUtils';
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
  countAgentCallsBetween,
  countAgentPipelineBetween,
  getAgentCallCounts,
  getManagerStats,
  getWeeklySummaryWindow,
  israelDayRange,
  israelWeekRange,
  resolveActivityAction,
  shouldShowWeeklySummaryReminder,
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
  FIESTA_REGIONS,
  normalizeFiestaRegion,
} from '../lib/fiestaCategoryMap';
import {
  ensureUploadedImageUrl,
  sanitizeImageList,
  slimSupplierForPush,
  uploadImageFile,
  isStoredOrRemoteImageUrl,
} from '../lib/uploadClientImage';
import {
  priceProduct,
  supplierNetPercent,
  isLowMargin,
  toAmount,
  toPercent,
  LOW_MARGIN_THRESHOLD_PERCENT,
} from '../lib/pricing';
import {
  ALL_EVENTS_LABEL,
  FIESTA_EVENT_TYPES,
  emptyEventPriceRow,
  needsPriceDifferenceChoice,
  normalizePushEventTypes,
} from '../lib/fiestaEventTypes';
import './globals.css';

const LOGIN_AGENTS = ['ינון', 'הודיה', 'טל', 'נתנאל', 'מאגר כללי'];
const WORKING_AGENTS = ['ינון', 'הודיה', 'טל'];
const VIEW_ALL_AGENTS = new Set(['נתנאל', 'מאגר כללי']);
const YINON_WORK_GROUPS = [
  { id: 'makeup', label: 'מאפרות', keywords: ['מאפר', 'איפור', 'makeup', 'mua'] },
  { id: 'dresses', label: 'שמלות כלה', keywords: ['שמלות כלה', 'שמלת כלה', 'שמלות', 'bridal dress', 'bridal gown', 'gown'] },
  { id: 'hair', label: 'עיצוב שיער', keywords: ['עיצוב שיער', 'מסרק', 'תסרוק', 'שיער', 'hair style', 'braids', 'צמות'] },
];

function supplierSearchText(supplier) {
  return [
    supplier?.Category,
    supplier?.category,
    supplier?.['Supplier Name'],
    supplier?.name,
    supplier?.clean_name,
    supplier?.description,
  ].filter(Boolean).join(' ').toLowerCase();
}

function textMatchesKeywords(text, keywords) {
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

function getYinonWorkGroup(supplier) {
  const text = supplierSearchText(supplier);
  if (!text) return null;
  if (textMatchesKeywords(text, YINON_WORK_GROUPS[0].keywords)) return 'makeup';
  if (textMatchesKeywords(text, YINON_WORK_GROUPS[2].keywords)) return 'hair';
  if (textMatchesKeywords(text, YINON_WORK_GROUPS[1].keywords)) return 'dresses';
  return null;
}

const PHOTO_KEYWORDS = ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל', 'photographer', 'photography', 'video'];
const DJ_KEYWORDS = ['מוזיקה', "די ג'יי", 'די ג׳יי', 'דיג׳י', 'דיגיי', 'תקליטן', 'dj', 'music'];

function isPhotographerSupplier(supplier) {
  return textMatchesKeywords(supplierSearchText(supplier), PHOTO_KEYWORDS);
}

function isDjSupplier(supplier) {
  return textMatchesKeywords(supplierSearchText(supplier), DJ_KEYWORDS);
}

function makeWizardProduct(index) {
  return { id: `p${Date.now().toString(36)}${index}`, name: '', originalPrice: '', kind: 'main', image: '' };
}

/**
 * Fill empty product images from the gallery (round-robin). Keeps any image
 * the agent already picked for a product.
 */
function applyGalleryImagesToProducts(products, gallery) {
  const imgs = (gallery || []).map((u) => String(u || '').trim()).filter(Boolean);
  if (!imgs.length) return products || [];
  let autoIdx = 0;
  return (products || []).map((p) => {
    if (String(p.image || '').trim()) return p;
    const image = imgs[autoIdx % imgs.length];
    autoIdx += 1;
    return { ...p, image };
  });
}

/** Turn the agent's list prices into the full product records Fiesta stores. */
function buildPricedProducts(products, discountPercent, commissionPercent) {
  return (products || [])
    .filter((p) => String(p.name || '').trim() && toAmount(p.originalPrice) > 0)
    .map((p, i) => {
      const computed = priceProduct(p.originalPrice, discountPercent, commissionPercent);
      return {
        id: p.id || `p${i + 1}`,
        name: String(p.name).trim(),
        description: '',
        originalPrice: String(computed.listPrice),
        price: String(computed.clientPrice),
        image: String(p.image || '').trim(),
        kind: p.kind === 'addon' ? 'addon' : 'main',
        commissionAmount: computed.commission,
        order: i,
        active: true,
      };
    });
}

/** The package the vendor card will advertise. */
function cheapestPricedPackage(pricedProducts) {
  return pricedProducts
    .filter((p) => p.kind === 'main' && Number(p.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price))[0];
}

function ilsShort(value) {
  return `₪${(Number(value) || 0).toLocaleString('he-IL')}`;
}

/**
 * Make /media/... and other relative paths previewable in the CRM browser.
 * Default CDN hosts compressed copies from github.com/nati325/for-photos
 * (free jsDelivr). Override with NEXT_PUBLIC_MEDIA_BASE_URL if needed.
 * Binaries stay off Mongo — only path strings live in the CRM DB.
 */
const DEFAULT_MEDIA_CDN = 'https://cdn.jsdelivr.net/gh/nati325/for-photos@main';

function resolveWizardImageSrc(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }
  if (!value.startsWith('/')) return value;

  const mediaBase = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL || DEFAULT_MEDIA_CDN).replace(/\/$/, '');
  if (value.startsWith('/media/')) {
    return `${mediaBase}${value}`;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${value}`;
  }
  return value;
}

function normalizeSupplierRow(s) {
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
}

function isValidSupplierRow(s) {
  const name = (s['Supplier Name'] || s.clean_name || '').trim();
  const phone = s['Real Phone'] || s.phone || '';
  return name && name !== 'ספק ללא שם' && phone && phone !== 'FAILED' && phone !== 'N/A';
}

function LoadingSpinner({ size = 40, label = 'טוען...' }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 14px',
        }}
      />
      {label ? <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>{label}</p> : null}
    </div>
  );
}

function parseSupplierIndexQuery(raw) {
  const q = String(raw || '').trim();
  const m1 = q.match(/^#?(\d+)$/);
  if (m1) return Number(m1[1]);
  const m2 = q.match(/^ספק\s+(\d+)$/);
  if (m2) return Number(m2[1]);
  return null;
}

function WizardGalleryThumb({ imgUrl, idx, onRemove }) {
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const src = resolveWizardImageSrc(imgUrl);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1',
        borderRadius: '8px',
        overflow: 'hidden',
        border: status === 'error' ? '1.5px solid #fca5a5' : '1px solid var(--border)',
        background: '#e2e8f0',
      }}
    >
      {status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.65rem',
            fontWeight: 700,
            color: '#64748b',
            zIndex: 1,
          }}
        >
          טוען…
        </div>
      )}
      {status === 'error' ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            textAlign: 'center',
            fontSize: '0.62rem',
            fontWeight: 700,
            color: '#b91c1c',
            background: '#fef2f2',
          }}
        >
          לא נטען
        </div>
      ) : (
        <img
          src={src}
          alt={`img-${idx}`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: status === 'ok' ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
          onLoad={() => setStatus('ok')}
          onError={() => setStatus('error')}
        />
      )}
      <button
        onClick={onRemove}
        type="button"
        style={{
          position: 'absolute',
          top: '3px',
          left: '3px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: '#ef4444',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: '9px',
          fontWeight: '800',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}
        title="הסר תמונה"
      >
        ✕
      </button>
    </div>
  );
}

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
  const [yinonWorkGroup, setYinonWorkGroup] = useState('makeup');
  const [showWeeklySummary, setShowWeeklySummary] = useState(false);
  const [weeklySummaryDismissed, setWeeklySummaryDismissed] = useState(false);
  const [showReminderSuccess, setShowReminderSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const isSearchMode = searchQuery.trim() !== '';
  const effectiveSearchQuery = isSearchMode ? debouncedSearchQuery.trim() : '';
  const [selectedSupplierProfile, setSelectedSupplierProfile] = useState(null);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescriptionText, setEditedDescriptionText] = useState('');
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [apiHealthWarning, setApiHealthWarning] = useState(null);
  const [statesLoadWarning, setStatesLoadWarning] = useState(null);
  const [supplierImages, setSupplierImages] = useState({}); // phone → imageUrl | 'loading' | 'error'
  const [fetchingAllImages, setFetchingAllImages] = useState(false);
  const [imageFetchProgress, setImageFetchProgress] = useState({ done: 0, total: 0 });
  const imageFetchAttemptedRef = useRef(new Set());
  const [sessionRestored, setSessionRestored] = useState(false);
  const pendingRestoreRef = useRef({ scrollY: null, selectedPhone: null });
  const scrollSaveTimerRef = useRef(null);
  const assignmentsSyncedRef = useRef(false);
  const supplierStatesRef = useRef({});
  const suppliersRef = useRef([]);
  const notesSaveTimersRef = useRef({});
  const updateSupplierStateRef = useRef(() => {});
  const [moveEffects, setMoveEffects] = useState({});
  const [exitingSuppliers, setExitingSuppliers] = useState({});
  const [activeMoveButton, setActiveMoveButton] = useState(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState(null);
  /** Queue of phones that need an outcome after a call: { phoneKey, phone, name } */
  const [pendingCallOutcomes, setPendingCallOutcomes] = useState([]);
  const [callOutcomeCallbackMode, setCallOutcomeCallbackMode] = useState(false);
  const [feedCursor, setFeedCursor] = useState(null);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [serverTabCounts, setServerTabCounts] = useState(null);
  const [serverFeedStats, setServerFeedStats] = useState(null);
  const [serverAgentStats, setServerAgentStats] = useState(null);
  const feedRequestIdRef = useRef(0);
  const lastFeedKeyRef = useRef('');

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
    types: [],
    description: '',
    region: '',
    regions: [],
    discountPercent: '',   // הנחה ללקוח — חלה על כל המוצרים (לחישוב)
    discountDisplayType: 'percent', // איך התגית באתר: percent | amount
    commissionPercent: '', // עמלת Fiesta — אחוז מהמחירון
    products: [],
    agreementSigned: false,
    agreementImages: [],
    agreementImage: '',
    fitsAllEvents: false,
    samePriceForEvents: true,
    eventTypes: [],
    eventPriceRows: {},
  });

  const pushAgreementImages = Array.isArray(fiestaPushForm.agreementImages)
    ? fiestaPushForm.agreementImages.filter(Boolean).slice(0, 3)
    : fiestaPushForm.agreementImage
      ? [fiestaPushForm.agreementImage]
      : [];
  const pushSelectedTypes = [...new Set(
    [fiestaPushForm.type, ...(Array.isArray(fiestaPushForm.types) ? fiestaPushForm.types : [])]
      .filter(Boolean)
  )];
  const pushSelectedRegions = [...new Set(
    [fiestaPushForm.region, ...(Array.isArray(fiestaPushForm.regions) ? fiestaPushForm.regions : [])]
      .filter(Boolean)
  )];

  const togglePushCategory = (slug) => {
    setFiestaPushForm((f) => {
      const current = [...new Set([f.type, ...(f.types || [])].filter(Boolean))];
      const has = current.includes(slug);
      let next = has ? current.filter((t) => t !== slug) : [...current, slug];
      if (!next.length) next = [slug];
      return { ...f, types: next, type: next[0] };
    });
  };

  const togglePushRegion = (slug) => {
    setFiestaPushForm((f) => {
      const current = [...new Set([f.region, ...(f.regions || [])].filter(Boolean))];
      const has = current.includes(slug);
      let next = has ? current.filter((r) => r !== slug) : [...current, slug];
      return { ...f, regions: next, region: next[0] || '' };
    });
  };

  const pushSelectedEvents = fiestaPushForm.fitsAllEvents
    ? []
    : FIESTA_EVENT_TYPES.filter((et) => (fiestaPushForm.eventTypes || []).includes(et));
  const needsPriceDiffChoice = needsPriceDifferenceChoice({
    fitsAllEvents: fiestaPushForm.fitsAllEvents,
    eventTypes: pushSelectedEvents,
  });
  const usePerEventPricing = needsPriceDiffChoice && !fiestaPushForm.samePriceForEvents;
  const pricedEventTypes = fiestaPushForm.fitsAllEvents ? FIESTA_EVENT_TYPES : pushSelectedEvents;
  const firstPricedRow = fiestaPushForm.eventPriceRows?.[pricedEventTypes[0]] || emptyEventPriceRow();

  const togglePushEventType = (et) => {
    setFiestaPushForm((f) => {
      const current = Array.isArray(f.eventTypes) ? f.eventTypes : [];
      const has = current.includes(et);
      const next = has ? current.filter((item) => item !== et) : [...current, et];
      const rows = { ...(f.eventPriceRows || {}) };
      if (!has && !rows[et]) rows[et] = emptyEventPriceRow();
      return { ...f, fitsAllEvents: false, eventTypes: next, eventPriceRows: rows };
    });
  };

  const setFitsAllEvents = () => {
    setFiestaPushForm((f) => ({ ...f, fitsAllEvents: true, eventTypes: [] }));
  };

  const setSamePriceForEvents = (same) => {
    setFiestaPushForm((f) => {
      const types = f.fitsAllEvents
        ? FIESTA_EVENT_TYPES
        : FIESTA_EVENT_TYPES.filter((et) => (f.eventTypes || []).includes(et));
      const rows = { ...(f.eventPriceRows || {}) };
      if (!same) {
        types.forEach((et) => {
          if (!rows[et]) rows[et] = emptyEventPriceRow();
        });
      }
      return { ...f, samePriceForEvents: same, eventPriceRows: rows };
    });
  };

  const updateEventPriceRow = (et, patch) => {
    setFiestaPushForm((f) => ({
      ...f,
      eventPriceRows: {
        ...(f.eventPriceRows || {}),
        [et]: { ...(f.eventPriceRows?.[et] || emptyEventPriceRow()), ...patch },
      },
    }));
  };

  // Same-price path uses the two global rates. Per-event path uses each row;
  // products still need a single pair, so they follow the first event type.
  const pushDiscountPercent = toPercent(
    usePerEventPricing ? firstPricedRow.discountPercent : fiestaPushForm.discountPercent
  );
  const pushCommissionPercent = toPercent(
    usePerEventPricing
      ? (firstPricedRow.commissionPercent || fiestaPushForm.commissionPercent)
      : fiestaPushForm.commissionPercent
  );
  const pushPricedProducts = buildPricedProducts(
    fiestaPushForm.products,
    pushDiscountPercent,
    pushCommissionPercent
  );
  const pushBaseProduct = cheapestPricedPackage(pushPricedProducts);
  const pushNetPercent = supplierNetPercent(pushDiscountPercent, pushCommissionPercent);
  const pushLowMargin =
    (fiestaPushForm.products || []).length > 0 &&
    isLowMargin(pushDiscountPercent, pushCommissionPercent);

  const updatePushProduct = (index, patch) =>
    setFiestaPushForm((f) => ({
      ...f,
      products: f.products.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));

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
    'ינון': ['מאפרות', 'איפור', 'שיער', 'שמלות כלה', 'makeup', 'hair', 'dresses'],
    'הודיה': ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל', 'photographer'],
    'טל': ['צלמים', 'צילום', 'צלם', 'וידאו', 'סושיאל', 'photographer'],
    'נתנאל': [],
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
  const isSupplierIrrelevant = (phone) => stateFor(phone).status === 'irrelevant';

  const STATUS_ORDER = ['לא נגעו בכלל', 'לחזור אליהם', 'לא ענו', 'עדיין לא חתם', 'סירבו', 'טופלו'];

  const buildDisplayList = (list) => {
    if (!WORKING_AGENTS.includes(activeAgent) || !isSearchMode) {
      return list.map((supplier) => ({ type: 'supplier', supplier }));
    }
    const grouped = new Map(STATUS_ORDER.map((tab) => [tab, []]));
    list.forEach((supplier) => {
      const tab = getSupplierTab(supplier['Real Phone'] || supplier.phone, activeAgent) || 'לא נגעו בכלל';
      if (!grouped.has(tab)) grouped.set(tab, []);
      grouped.get(tab).push(supplier);
    });
    const display = [];
    STATUS_ORDER.forEach((tab) => {
      const items = grouped.get(tab) || [];
      if (!items.length) return;
      display.push({ type: 'header', group: tab, label: tab, count: items.length });
      items.forEach((supplier) => display.push({ type: 'supplier', supplier }));
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

  const moranTouchedState = (state = {}) => {
    if (!state) return false;
    if (state.firstTouchedBy === 'מורן' || state.lastTouchedBy === 'מורן') return true;
    if (state.agent === 'מורן' || state.assignedAgent === 'מורן') return true;
    return Array.isArray(state.activityLog) && state.activityLog.some((entry) => entry.agent === 'מורן');
  };

  const previousAgentName = (state = {}) => {
    if (!state) return '';
    return state.lastTouchedBy || state.firstTouchedBy || state.assignedAgent || state.agent || '';
  };

  const agentHasWorkedSupplier = (state = {}, agent) => {
    if (!agent || VIEW_ALL_AGENTS.has(agent)) return isSupplierTouched(state);
    if (!state) return false;
    if (agent === 'ינון' && moranTouchedState(state)) return true;
    if ((agent === 'הודיה' || agent === 'טל') && isSupplierTouched(state)) return true;
    if (state.firstTouchedBy === agent || state.lastTouchedBy === agent) return true;
    if (state.agent === agent) return true;
    if (Array.isArray(state.activityLog) && state.activityLog.some((entry) => entry.agent === agent)) {
      return true;
    }
    return false;
  };

  const stateForAgent = (phone, agent = activeAgent) => {
    const state = stateFor(phone);
    return agentHasWorkedSupplier(state, agent) ? state : {};
  };

  const supplierBelongsToAgent = (supplier, agent) => {
    if (VIEW_ALL_AGENTS.has(agent)) return true;
    const phone = supplier['Real Phone'] || supplier.phone;
    const owner = stateFor(phone).photoOwner || '';
    if (agent === 'ינון') return getYinonWorkGroup(supplier) != null;
    if (agent === 'הודיה') return isPhotographerSupplier(supplier) && owner !== 'טל';
    if (agent === 'טל') return isPhotographerSupplier(supplier) && owner === 'טל';
    const allowedCategories = agentCategoryMap[agent] || [];
    if (supplier.Category === 'ספקים ללא קטגוריה' || !supplier.Category) return true;
    return allowedCategories.some((cat) => String(supplier.Category).includes(cat));
  };

  const supplierInYinonView = (supplier) => {
    if (activeAgent !== 'ינון') return true;
    return getYinonWorkGroup(supplier) === yinonWorkGroup;
  };

  const getSupplierTab = (phone, agent = activeAgent) => {
    if (isSupplierIrrelevant(phone)) return null;
    const state = stateForAgent(phone, agent);
    const isHandled = state.status === 'not-interested' || state.status === 'contract';
    const isCallback = !!state.callbackScheduled || state.status === 'thinking' || state.status === 'no-answer';

    if (!isSupplierTouched(state)) return 'לא נגעו בכלל';
    if (state.status === 'not-available') return 'לא ענו';
    if (state.status === 'not-signed') return 'עדיין לא חתם';
    if (WORKING_AGENTS.includes(agent) && state.status === 'not-interested') return 'סירבו';
    if (isHandled) return 'טופלו';
    if (isCallback) return 'לחזור אליהם';
    return null;
  };

  const feedSuppliers = useMemo(() => {
    if (isSearchMode) {
      return (searchResults ?? [])
        .filter(isValidSupplierRow)
        .filter((supplier) => supplierBelongsToAgent(supplier, activeAgent))
        .filter(supplierInYinonView)
        .filter((supplier) => !isSupplierIrrelevant(supplier['Real Phone'] || supplier.phone))
        .sort((a, b) => {
          const tabA = getSupplierTab(a['Real Phone'] || a.phone, activeAgent);
          const tabB = getSupplierTab(b['Real Phone'] || b.phone, activeAgent);
          const order = STATUS_ORDER.indexOf(tabA) - STATUS_ORDER.indexOf(tabB);
          if (order) return order;
          return (a['Supplier Name'] || '').localeCompare(b['Supplier Name'] || '', 'he');
        });
    }

    // Server already filtered by agent/tab; keep exit animation + live tab check after moves.
    return suppliers
      .filter((s) => {
        const phone = s['Real Phone'] || s.phone;
        const exitInfo = exitingSuppliers[phone];
        if (exitInfo?.fromTab === activeTab) return true;
        if (isSupplierIrrelevant(phone)) return false;
        return getSupplierTab(phone, activeAgent) === activeTab;
      })
      .filter(isValidSupplierRow);
  }, [
    isSearchMode,
    searchResults,
    suppliers,
    activeAgent,
    activeTab,
    yinonWorkGroup,
    exitingSuppliers,
    supplierStates,
  ]);

  const feedImageKey = useMemo(
    () => feedSuppliers.map((s) => s['Real Phone'] || s.phone).join('|'),
    [feedSuppliers]
  );

  const getAgentFeedSuppliers = (agent) => {
    if (!agent || VIEW_ALL_AGENTS.has(agent)) return [];
    return suppliers.filter((supplier) => {
      if (!supplierBelongsToAgent(supplier, agent)) return false;
      const name = (supplier['Supplier Name'] || supplier.clean_name || '').trim();
      const phone = supplier['Real Phone'] || supplier.phone || '';
      if (!name || name === 'ספק ללא שם' || !phone || phone === 'FAILED' || phone === 'N/A') return false;
      return !isSupplierIrrelevant(phone);
    });
  };

  const getAgentFeedStats = (agent) => {
    if (serverFeedStats && agent === activeAgent) {
      return serverFeedStats;
    }
    return { total: 0, touched: 0, untouched: 0 };
  };

  const getAgentPipelineStats = (agent, fromMs, toMs) => {
    const bucket = serverAgentStats?.[agent];
    if (bucket?.pipeline) {
      const day = israelDayRange();
      const week = israelWeekRange();
      if (fromMs === day.start && toMs === day.end) return bucket.pipeline.today;
      if (fromMs === week.start && toMs === week.end) return bucket.pipeline.week;
    }
    return countAgentPipelineBetween(supplierStates, agent, fromMs, toMs);
  };

  const buildAgentAssignments = (agent) => {
    return getAgentFeedSuppliers(agent).map((supplier) => {
      const phone = supplier['Real Phone'] || supplier.phone;
      return {
        phone,
        assignedAgent: agent,
        assignedCategory: supplier.Category || 'כללי',
        supplierName: supplier['Supplier Name'] || supplier.clean_name || '',
      };
    });
  };

  const persistUiForAgent = (agent, overrides = {}) => {
    if (!agent) return;
    saveUiState(agent, {
      activeTab,
      yinonWorkGroup,
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
      yinonWorkGroup,
      searchQuery,
      selectedPhone: getSupplierPhone(selectedSupplierProfile),
    });
  };

  const persistFullUiSnapshot = (agent) => {
    if (!agent || typeof window === 'undefined') return;
    saveUiState(agent, {
      activeTab,
      yinonWorkGroup,
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
      setYinonWorkGroup('makeup');
      setSearchQuery('');
      setSelectedSupplierProfile(null);
      pendingRestoreRef.current = { scrollY: null, selectedPhone: null };
      return;
    }
    const restoredTab = ui.activeTab === 'לטיפול' ? 'לא נגעו בכלל' : (ui.activeTab || 'לא נגעו בכלל');
    setActiveTab(restoredTab);
    if (YINON_WORK_GROUPS.some((group) => group.id === ui.yinonWorkGroup)) {
      setYinonWorkGroup(ui.yinonWorkGroup);
    }
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
    if (session && LOGIN_AGENTS.includes(session.agent)) {
      setActiveAgent(session.agent);
      setIsLoggedIn(true);
      saveSession(session.agent);
      applyUiState(loadUiState(session.agent));
    } else if (session) {
      clearSession();
    }
    setSessionRestored(true);
  }, []);

  useEffect(() => {
    supplierStatesRef.current = supplierStates;
  }, [supplierStates]);

  useEffect(() => {
    suppliersRef.current = suppliers;
  }, [suppliers]);

  useEffect(() => {
    if (!isLoggedIn || !activeAgent || loading) return;
    persistUiMetaForAgent(activeAgent);
  }, [activeTab, yinonWorkGroup, searchQuery, selectedSupplierProfile, isLoggedIn, activeAgent, loading]);

  useEffect(() => {
    if (!isLoggedIn || !activeAgent) return;

    const saveScrollPosition = () => {
      saveUiState(activeAgent, { scrollY: window.scrollY });
    };

    const saveBeforeLeave = () => {
      const timers = notesSaveTimersRef.current;
      Object.keys(timers).forEach((key) => {
        clearTimeout(timers[key]);
        delete timers[key];
        const notes = supplierStatesRef.current[key]?.notes ?? '';
        updateSupplierStateRef.current(key, { notes });
      });
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

  // With server-paginated feeds, an empty tab is valid — do not auto-jump.
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

  const clearSearch = () => setSearchQuery('');

  // Search must NOT depend on `suppliers` — image/profile updates mutate that array
  // and were re-triggering fetch + blanking the grid ("appears then vanishes").
  useEffect(() => {
    if (!isSearchMode) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    if (!effectiveSearchQuery) {
      setSearchLoading(true);
      return;
    }

    const indexQuery = parseSupplierIndexQuery(effectiveSearchQuery);
    if (indexQuery !== null) {
      const list = suppliersRef.current;
      if (loading && list.length === 0) {
        setSearchLoading(true);
        return;
      }
      const match = indexQuery > 0 && indexQuery <= list.length ? list[indexQuery - 1] : null;
      setSearchResults(match ? [match] : []);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);

    fetch(`/api/suppliers?lite=1&search=${encodeURIComponent(effectiveSearchQuery)}&limit=40&agent=${encodeURIComponent(activeAgent || '')}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!Array.isArray(data)) {
          setSearchResults([]);
          return;
        }
        setSearchResults(data.map(normalizeSupplierRow).filter(isValidSupplierRow));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Search failed:', err);
          setSearchResults([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearchLoading(false);
      });

    return () => controller.abort();
  }, [isSearchMode, effectiveSearchQuery, loading, activeAgent]);

  useEffect(() => {
    // Fast boot: local states only — suppliers come from paginated /api/feed after login.
    const localStates = loadAllSupplierStatesLocal();
    setSupplierStates(localStates);
    setLoading(false);
  }, []);

  const mergeFeedStates = (incoming = {}) => {
    setSupplierStates((prev) => {
      const next = { ...prev };
      for (const [key, state] of Object.entries(incoming || {})) {
        const nk = phoneKey(key);
        if (!nk) continue;
        next[nk] = { ...(next[nk] || {}), ...state, phone: nk, phoneKey: nk };
      }
      saveAllSupplierStatesLocal(next);
      return next;
    });
  };

  const fetchServerStats = async (agent) => {
    if (!agent) return;
    try {
      const statsUrl =
        agent === 'ינון'
          ? '/api/agent-stats'
          : `/api/agent-stats?agent=${encodeURIComponent(agent)}`;
      const [statsRes, tabsRes] = await Promise.all([
        fetch(statsUrl, { cache: 'no-store' }),
        fetch(
          `/api/tab-counts?agent=${encodeURIComponent(agent)}&yinonWorkGroup=${encodeURIComponent(yinonWorkGroup)}`,
          { cache: 'no-store' }
        ),
      ]);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setServerAgentStats(statsData.agents || null);
      }
      if (tabsRes.ok) {
        const tabsData = await tabsRes.json();
        setServerTabCounts(tabsData.counts || null);
        setServerFeedStats(tabsData.feedStats || null);
      }
    } catch (err) {
      console.error('stats/tab-counts failed:', err);
    }
  };

  const scheduleClientAssign = (agent, suppliers) => {
    if (!agent || !WORKING_AGENTS.includes(agent) || !suppliers?.length) return;
    const items = suppliers.map((s) => ({
      phone: s['Real Phone'] || s.phone,
      assignedCategory: s.Category || 'כללי',
      supplierName: s['Supplier Name'] || s.clean_name || '',
    })).filter((item) => item.phone);
    if (!items.length) return;
    fetch('/api/feed/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, items }),
      keepalive: true,
    }).catch(() => {});
  };

  const applyBootstrapPayload = (data) => {
    if (data.agents) setServerAgentStats(data.agents);
    if (data.counts) setServerTabCounts(data.counts);
    if (data.feedStats) setServerFeedStats(data.feedStats);

    const feed = data.feed || {};
    const incoming = (feed.suppliers || []).map(normalizeSupplierRow).filter(isValidSupplierRow);
    mergeFeedStates(feed.states || {});
    setSuppliers(incoming);
    setFeedCursor(feed.nextCursor || null);
    setFeedHasMore(Boolean(feed.hasMore));
    if (activeTab === 'לא נגעו בכלל') {
      scheduleClientAssign(activeAgent, incoming);
    }
  };

  const loadAgentBootstrap = async () => {
    if (!activeAgent || isSearchMode) return;
    const limit = VIEW_ALL_AGENTS.has(activeAgent) ? 20 : 10;
    const requestId = ++feedRequestIdRef.current;
    setFeedLoading(true);
    try {
      const params = new URLSearchParams({
        agent: activeAgent,
        tab: activeTab,
        yinonWorkGroup,
        limit: String(limit),
      });

      const res = await fetch(`/api/bootstrap?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`bootstrap ${res.status}`);
      const data = await res.json();
      if (requestId !== feedRequestIdRef.current) return;
      applyBootstrapPayload(data);
    } catch (err) {
      console.error('loadAgentBootstrap failed:', err);
      setApiHealthWarning('לא הצלחנו לטעון את הפיד מהשרת. נסי לרענן.');
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setFeedLoading(false);
        setFeedLoadingMore(false);
      }
    }
  };

  const loadAgentFeed = async ({ append = false, refillCount = 0 } = {}) => {
    if (!activeAgent || isSearchMode) return;
    const limit = VIEW_ALL_AGENTS.has(activeAgent) ? 20 : 10;
    const requestId = ++feedRequestIdRef.current;
    const exclude = append || refillCount
      ? suppliersRef.current.map((s) => phoneKey(s['Real Phone'] || s.phone)).filter(Boolean).join(',')
      : '';

    if (refillCount) {
      // keep UI snappy
    } else if (append) {
      setFeedLoadingMore(true);
    } else {
      setFeedLoading(true);
    }

    try {
      const params = new URLSearchParams({
        agent: activeAgent,
        tab: activeTab,
        yinonWorkGroup,
        limit: String(refillCount || limit),
      });
      if (append && feedCursor) params.set('cursor', feedCursor);
      if (exclude) params.set('exclude', exclude);
      if (refillCount) params.set('refill', '1');

      const res = await fetch(`/api/feed?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`feed ${res.status}`);
      const data = await res.json();
      if (requestId !== feedRequestIdRef.current) return;

      const incoming = (data.suppliers || []).map(normalizeSupplierRow).filter(isValidSupplierRow);
      mergeFeedStates(data.states || {});

      setSuppliers((prev) => {
        if (!append && !refillCount) return incoming;
        const seen = new Set(prev.map((s) => phoneKey(s['Real Phone'] || s.phone)));
        const merged = [...prev];
        incoming.forEach((s) => {
          const key = phoneKey(s['Real Phone'] || s.phone);
          if (!key || seen.has(key)) return;
          seen.add(key);
          merged.push(s);
        });
        return merged;
      });

      if (!refillCount) {
        setFeedCursor(data.nextCursor || null);
        setFeedHasMore(Boolean(data.hasMore));
      }
      if (typeof data.totalMatching === 'number' && activeTab === 'לא נגעו בכלל') {
        setServerTabCounts((prev) => ({
          ...(prev || {}),
          'לא נגעו בכלל': data.totalMatching,
        }));
      }
      if (activeTab === 'לא נגעו בכלל' && incoming.length) {
        scheduleClientAssign(activeAgent, incoming);
      }
    } catch (err) {
      console.error('loadAgentFeed failed:', err);
      setApiHealthWarning('לא הצלחנו לטעון את הפיד מהשרת. נסי לרענן.');
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setFeedLoading(false);
        setFeedLoadingMore(false);
      }
    }
  };

  const refillUntouchedFeed = () => {
    if (!activeAgent || activeTab !== 'לא נגעו בכלל' || isSearchMode) return;
    loadAgentFeed({ refillCount: 1 });
  };

  useEffect(() => {
    if (!isLoggedIn || !activeAgent || isSearchMode) return;
    const key = `${activeAgent}|${activeTab}|${yinonWorkGroup}`;
    if (lastFeedKeyRef.current === key && suppliersRef.current.length) return;
    lastFeedKeyRef.current = key;
    setSuppliers([]);
    setFeedCursor(null);
    setFeedHasMore(false);
    // Initial tab load: one round-trip for stats + counts + feed.
    loadAgentBootstrap();
  }, [isLoggedIn, activeAgent, activeTab, yinonWorkGroup, isSearchMode]);

  useEffect(() => {
    // Disable full-catalog assignment sync — assignments happen on feed fetch.
    if (!isLoggedIn || !activeAgent || VIEW_ALL_AGENTS.has(activeAgent)) return;
    assignmentsSyncedRef.current = true;
  }, [isLoggedIn, activeAgent]);

  // Persistent callback reminder checker running every 5 seconds
  useEffect(() => {
    if (!isLoggedIn || !activeAgent) return;

    const checkReminders = () => {
      const now = Date.now();
      const newAlerts = [];

      Object.values(supplierStatesRef.current || {}).forEach((state) => {
        if (!state || Object.keys(state).length === 0) return;
        const phone = state.phone || state.phoneKey;
        if (!phone) return;

        // Condition for active, non-dismissed callback reminder
        if (state.callbackTimestamp && now >= state.callbackTimestamp && state.callbackDismissed !== true) {
          if (
            agentHasWorkedSupplier(state, activeAgent)
            && (state.lastTouchedBy === activeAgent || state.firstTouchedBy === activeAgent)
          ) {
            newAlerts.push({
              id: phone,
              supplierName: state.supplierName || phone,
              phone,
              phoneKey: phoneKey(phone) || phone,
              scheduledTime: state.callbackScheduled || 'הזמן שנבחר'
            });

            // Send email and browser push notification if not already sent
            if (!state.callbackEmailSent) {
              updateSupplierStateRef.current(phone, { callbackEmailSent: true });

              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  new Notification(`תזכורת - ${state.supplierName || phone}`, {
                    body: `הגיע הזמן לחזור לספק!\nטלפון: ${phone}`,
                    requireInteraction: true
                  });
                } catch {
                  /* iOS / some WebViews throw even when permission is granted */
                }
              }

              fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  supplierName: state.supplierName || phone,
                  phone,
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

  const handleSupplierImageError = (supplier, e) => {
    const phone = supplier['Real Phone'] || supplier.phone || '';
    const img = e.currentTarget;
    const srcAttr = img.getAttribute('src') || '';
    let current = srcAttr;
    try {
      const abs = new URL(img.src, window.location.origin);
      current = abs.pathname.startsWith('/media/') ? abs.pathname : srcAttr;
    } catch {
      current = srcAttr;
    }

    const next = getNextImageCandidate(supplier, current);
    if (next && next !== current) {
      setSupplierImages((prev) => ({ ...prev, [phone]: next }));
      applyImageToSupplier(phone, next);
      img.src = resolveWizardImageSrc(next);
      return;
    }

    const fetchKey = `err:${phone}`;
    if (phone && !imageFetchAttemptedRef.current.has(fetchKey)) {
      imageFetchAttemptedRef.current.add(fetchKey);
      fetchImageForSupplier(supplier).then((url) => {
        if (url) {
          img.src = resolveWizardImageSrc(url);
          img.parentElement && (img.parentElement.style.display = '');
        } else if (img.parentElement) {
          img.parentElement.style.display = 'none';
        }
      });
      return;
    }

    if (img.parentElement) img.parentElement.style.display = 'none';
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
      setSupplierImages((prev) => ({ ...prev, [phone]: existing }));
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

  // Load images for the agent's current feed (tab / search), not the entire database
  useEffect(() => {
    if (!isLoggedIn || loading || !feedSuppliers.length) return;

    const seeded = {};
    feedSuppliers.forEach((s) => {
      const phone = s['Real Phone'] || s.phone || '';
      if (!phone) return;
      const best = pickBestStoredImage(s);
      // Seed both local /media/ and remote http — binaries stay on disk, not in Mongo.
      if (best) seeded[phone] = best;
    });
    if (Object.keys(seeded).length) {
      setSupplierImages((prev) => ({ ...seeded, ...prev }));
    }

    let cancelled = false;
    (async () => {
      const missing = feedSuppliers
        .filter((s) => !pickBestStoredImage(s) && (getEngagedUrl(s) || getGoogleImageUrl(s)))
        .filter((s) => {
          const phone = s['Real Phone'] || s.phone || '';
          return phone && !imageFetchAttemptedRef.current.has(phone);
        });

      missing.forEach((s) => imageFetchAttemptedRef.current.add(s['Real Phone'] || s.phone));

      for (let i = 0; i < missing.length; i += 5) {
        if (cancelled) break;
        await Promise.all(missing.slice(i, i + 5).map((s) => fetchImageForSupplier(s)));
        if (i + 5 < missing.length) await new Promise((r) => setTimeout(r, 400));
      }
    })();

    return () => { cancelled = true; };
  }, [feedImageKey, isLoggedIn, loading]);

  // ── Trigger Fiesta Push Modal ─────────────────────────────────────────────
  const collectPushImages = (supplier, cachedImg) => {
    const pushImages = [];
    const add = (img) => {
      if (!img || img === 'N/A' || img === 'nan') return;
      const value = String(img).trim();
      if (!value) return;
      if (value.startsWith('http') || value.startsWith('/media/') || value.startsWith('/api/image/') || value.startsWith('data:image/')) {
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
    const region = normalizeFiestaRegion(extractRegionFromAddress(address));

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
      types: mappedType ? [mappedType] : [],
      description: buildDefaultDescription(supplier),
      region,
      regions: region ? [region] : [],
      discountPercent: '',
      discountDisplayType: 'percent',
      commissionPercent: '',
      products: [makeWizardProduct(0)],
      agreementSigned: isSigned,
      selectedImages: pushImages,
      agreementImage: uploadedImage,
      agreementImages: uploadedImage ? [uploadedImage] : [],
      fitsAllEvents: false,
      samePriceForEvents: true,
      eventTypes: [],
      eventPriceRows: {},
    });
    setShowFiestaPushModal(true);
  };

  // ── Submit to Fiesta API ──────────────────────────────────────────────────
  const submitToFiesta = async () => {
    const selectedTypes = [...new Set(
      [fiestaPushForm.type, ...(fiestaPushForm.types || [])].filter(Boolean)
    )];
    if (!selectedTypes.length) {
      setFiestaPushError('יש לבחור לפחות קטגוריה אחת לפני השליחה');
      setFiestaPushStep(1);
      return;
    }

    setFiestaPushLoading(true);
    setFiestaPushResult(null);
    setFiestaPushError('');
    try {
      const discountPercent = pushDiscountPercent;
      const fitsAllEvents = Boolean(fiestaPushForm.fitsAllEvents);
      const eventTypes = normalizePushEventTypes({
        fitsAllEvents,
        eventTypes: fiestaPushForm.eventTypes,
      });
      const eventPrices = usePerEventPricing
        ? pricedEventTypes
            .map((et) => {
              const row = fiestaPushForm.eventPriceRows?.[et] || emptyEventPriceRow();
              const rowCommission = toPercent(row.commissionPercent || fiestaPushForm.commissionPercent);
              const computed = priceProduct(row.originalPrice, row.discountPercent, rowCommission);
              return {
                eventType: et,
                originalPrice: String(computed.listPrice || toAmount(row.originalPrice)),
                price: String(computed.clientPrice),
                discount: String(toPercent(row.discountPercent)),
                discountType: 'percent',
                commissionPercent: rowCommission,
                commissionAmount: computed.commission,
              };
            })
            .filter((row) => toAmount(row.originalPrice) > 0)
        : [];
      const cheapestEvent = eventPrices
        .slice()
        .sort((a, b) => toAmount(a.price) - toAmount(b.price))[0];
      const commissionPercent = cheapestEvent
        ? toPercent(cheapestEvent.commissionPercent)
        : toPercent(fiestaPushForm.commissionPercent);
      const gallery = await sanitizeImageList(
        fiestaPushForm.selectedImages || fiestaPushForm.images || []
      );
      const productsWithImages = applyGalleryImagesToProducts(
        fiestaPushForm.products,
        gallery
      );
      // Upload any leftover data URIs on product images before building the payload.
      const productsPrepared = [];
      for (let i = 0; i < productsWithImages.length; i++) {
        const p = productsWithImages[i];
        const image = p.image
          ? await ensureUploadedImageUrl(p.image, `product-${i + 1}.jpg`)
          : '';
        productsPrepared.push({ ...p, image });
      }
      const products = buildPricedProducts(productsPrepared, discountPercent, commissionPercent);
      const base = cheapestPricedPackage(products);
      // Display choice only: site badge shows % or ₪ savings of the card package.
      const displayAsAmount = fiestaPushForm.discountDisplayType === 'amount';
      const baseSavings = base
        ? Math.max(0, Number(base.originalPrice) - Number(base.price))
        : 0;
      const discountForSite = displayAsAmount
        ? String(baseSavings)
        : String(discountPercent);
      const discountTypeForSite = displayAsAmount ? 'amount' : 'percent';

      // Upload agreement / gallery data URIs first — never put multi‑MB base64 in the push JSON
      // (Vercel returns 413 Function payload too large).
      const rawAgreements = (
        Array.isArray(fiestaPushForm.agreementImages) && fiestaPushForm.agreementImages.length
          ? fiestaPushForm.agreementImages
          : fiestaPushForm.agreementImage
            ? [fiestaPushForm.agreementImage]
            : []
      )
        .filter((u) => u && u !== '[stored]')
        .slice(0, 3);

      const agreementImages = [];
      for (let i = 0; i < rawAgreements.length; i++) {
        const url = await ensureUploadedImageUrl(rawAgreements[i], `agreement-${i + 1}.jpg`);
        if (url && !agreementImages.includes(url)) agreementImages.push(url);
      }
      const agreementImage = agreementImages[0] || '';
      setFiestaPushForm((f) => ({
        ...f,
        agreementImages,
        agreementImage,
        selectedImages: gallery,
        products: productsPrepared,
      }));

      const res = await fetch('/api/push-to-fiesta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier: slimSupplierForPush(fiestaPushSupplier),
          fiestaData: {
            type: selectedTypes[0],
            types: selectedTypes,
            description: fiestaPushForm.description || '',
            region: pushSelectedRegions[0] || '',
            regions: pushSelectedRegions,
            agreementSigned: Boolean(fiestaPushForm.agreementSigned),
            agreementImage,
            agreementImages,
            selectedImages: gallery,
            images: gallery,
            products,
            mainProductId: base?.id || '',
            discount: cheapestEvent && !base
              ? cheapestEvent.discount
              : discountForSite,
            discountType: cheapestEvent && !base ? 'percent' : discountTypeForSite,
            commissionPercent,
            originalPrice: base?.originalPrice || cheapestEvent?.originalPrice || '0',
            price: base?.price || cheapestEvent?.price || '0',
            commissionAmount: base?.commissionAmount || cheapestEvent?.commissionAmount || 0,
            agentName: activeAgent,
            eventTypes: eventTypes.length ? eventTypes : [ALL_EVENTS_LABEL],
            eventTypesExplicit: true,
            eventPrices,
            fitsAllEvents,
            reviews: Array.isArray(fiestaPushForm.reviews)
              ? fiestaPushForm.reviews.slice(0, 30)
              : slimSupplierForPush(fiestaPushSupplier).reviews,
          },
        }),
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        setFiestaPushResult('error');
        const hint413 =
          res.status === 413
            ? 'הקובץ/הבקשה גדולים מדי לשרת. העלו מחדש את תמונת החוזה (תידחס אוטומטית) ונסו שוב.'
            : `תשובה לא תקינה מהשרת (HTTP ${res.status}): ${raw.slice(0, 180) || 'ריק'}`;
        setFiestaPushError(hint413);
        return;
      }
      if (!res.ok || data.error) {
        setFiestaPushResult('error');
        if (res.status === 413) {
          setFiestaPushError(
            'הבקשה גדולה מדי לשרת (413). העלו מחדש את תמונת החוזה ונסו שוב בלי תמונות ענק בגלריה.'
          );
        } else {
          setFiestaPushError(data.error || `שגיאה מהשרת (HTTP ${res.status})`);
        }
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
          agreementImage && isStoredOrRemoteImageUrl(agreementImage)
            ? agreementImage
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
      const img = pushAgreementImages[0] || fiestaPushForm.agreementImage;
      updateSupplierState(phone, {
        status: pendingStatusChange.status,
        reminder: null,
        agent: activeAgent,
        ...(isStoredOrRemoteImageUrl(img) ? { uploadedImage: img } : {}),
      });
    }
    setShowFiestaPushModal(false);
    setFiestaPushResult(null);
    setFiestaPushStep(1);
    setPendingStatusChange(null);
  };

  const handleModalFileChange = async (file) => {
    if (!file) return;
    try {
      setFiestaPushError('');
      const current = pushAgreementImages;
      if (current.length >= 3) {
        alert('ניתן לצרף עד 3 תמונות חוזה');
        return;
      }
      const url = await uploadImageFile(file);
      setFiestaPushForm((f) => {
        const next = [...(Array.isArray(f.agreementImages) ? f.agreementImages : []), url]
          .filter(Boolean)
          .slice(0, 3);
        return { ...f, agreementImages: next, agreementImage: next[0] || '' };
      });
    } catch (err) {
      setFiestaPushError(err.message || 'העלאת החוזה נכשלה');
      alert(`⚠️ לא ניתן להעלות את התמונה:\n${err.message}`);
    }
  };

  const removeAgreementImageAt = (index) => {
    setFiestaPushForm((f) => {
      const next = (Array.isArray(f.agreementImages) ? f.agreementImages : [])
        .filter((_, i) => i !== index);
      return { ...f, agreementImages: next, agreementImage: next[0] || '' };
    });
  };

  const renderWizardHeader = (step, title) => {
    const total = 7;
    const progress = (step / total) * 100;
    return (
      <div style={{ marginBottom: '24px', textAlign: 'center' }}>
        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
          {[1, 2, 3, 4, 5, 6, 7].map(s => (
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

  const enqueuePendingCallOutcome = (phone, supplierName) => {
    const key = phoneKey(phone);
    if (!key) return;
    setPendingCallOutcomes((prev) => [
      ...prev,
      {
        id: `${key}-${Date.now()}-${prev.length}`,
        phoneKey: key,
        phone,
        name: supplierName || 'ספק',
      },
    ]);
    setCallOutcomeCallbackMode(false);
  };

  const clearPendingCallOutcome = (phone) => {
    const key = phoneKey(phone);
    if (!key) return;
    setPendingCallOutcomes((prev) => {
      const idx = prev.findIndex((item) => item.phoneKey === key);
      if (idx < 0) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    setCallOutcomeCallbackMode(false);
  };

  const updateSupplierState = (phone, newState, options = {}) => {
    const { localOnly = false } = options;
    const key = phoneKey(phone);
    if (!key) return;

    const touchFields = ['status', 'callbackScheduled', 'reminder', 'notes', 'uploadedImage'];
    const isTouchAction = touchFields.some((field) => field in newState);
    const enrichedState = { ...newState };
    const prevState = supplierStatesRef.current[key] || supplierStates[key] || {};

    const activityAction = resolveActivityAction(newState);
    if (!localOnly && activityAction && activeAgent) {
      const log = prevState.activityLog || [];
      const last = log[log.length - 1];
      const skipDuplicateNotes =
        activityAction.action === 'notes' &&
        last?.action === 'notes' &&
        last.agent === activeAgent &&
        Date.now() - (last.at || 0) < 2 * 60 * 1000;
      if (!skipDuplicateNotes) {
        enrichedState.activityLog = appendActivityLog(
          log,
          buildActivityEntry(activityAction.action, activeAgent, activityAction)
        );
      }
    }

    if (!localOnly && ('status' in newState || 'callbackScheduled' in newState)) {
      clearPendingCallOutcome(key);
    }

    if (isTouchAction && !localOnly) {
      enrichedState.lastTouchedAt = Date.now();
      enrichedState.lastTouchedBy = activeAgent;
      if (!prevState.firstTouchedAt) {
        enrichedState.firstTouchedAt = Date.now();
        enrichedState.firstTouchedBy = activeAgent;
      }

      if (WORKING_AGENTS.includes(activeAgent)) {
        const supplier = suppliers.find((s) => phoneKey(s['Real Phone'] || s.phone) === key);
        if (supplier) {
          enrichedState.assignedAgent = activeAgent;
          enrichedState.supplierName = supplier['Supplier Name'] || supplier.clean_name || '';
          enrichedState.assignedCategory = supplier.Category || 'כללי';
        }
      }
    }

    setSupplierStates((prev) => {
      const merged = { ...(prev[key] || {}), ...enrichedState, phone: key };
      saveSupplierStateLocal(key, merged);
      return {
        ...prev,
        [key]: merged,
      };
    });

    if (localOnly) return;

    fetch('/api/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: key, state: enrichedState }),
    })
    .then(async res => {
      if (!res.ok) {
        let errMsg = 'שמירה נכשלה';
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
      if ('outboundCallAt' in newState && !isTouchAction) return;
      const raw = err.message || 'שגיאה לא ידועה';
      const hint = /timed out|Timeout|ETIMEOUT|server selection|ECONN/i.test(raw)
        ? 'המסד לא ענה בזמן. נסי שוב.'
        : raw;
      alert(`לא הצלחנו לשמור את השינוי.\n\n${hint}`);
    });
  };
  updateSupplierStateRef.current = updateSupplierState;

  const draftNotes = (phone, notes) => {
    const key = phoneKey(phone);
    if (!key) return;
    updateSupplierState(phone, { notes }, { localOnly: true });
    if (notesSaveTimersRef.current[key]) clearTimeout(notesSaveTimersRef.current[key]);
    notesSaveTimersRef.current[key] = setTimeout(() => {
      delete notesSaveTimersRef.current[key];
      updateSupplierState(phone, { notes });
    }, 800);
  };

  const commitNotes = (phone, notes) => {
    const key = phoneKey(phone);
    if (!key) return;
    if (notesSaveTimersRef.current[key]) {
      clearTimeout(notesSaveTimersRef.current[key]);
      delete notesSaveTimersRef.current[key];
    }
    updateSupplierState(phone, { notes });
  };

  const recordOutboundCall = (phone, supplierName) => {
    if (!phone || !activeAgent) return;
    updateSupplierState(phone, { outboundCallAt: Date.now() });
    const key = phoneKey(phone);
    const match = suppliers.find((s) => phoneKey(s['Real Phone'] || s.phone) === key);
    const name =
      supplierName ||
      match?.['Supplier Name'] ||
      match?.clean_name ||
      'ספק';
    enqueuePendingCallOutcome(phone, name);
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
      const wasUntouchedTab = activeTab === 'לא נגעו בכלל';
      updateSupplierState(phone, {
        callbackScheduled: timeStr,
        callbackTimestamp: reminderTime.getTime(),
        callbackDismissed: false,
        callbackEmailSent: false,
        agent: activeAgent,
      });
      setActiveCallbackPicker(null);
      if (wasUntouchedTab) {
        setTimeout(() => refillUntouchedFeed(), 400);
        fetchServerStats(activeAgent);
      }
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
    const timers = notesSaveTimersRef.current;
    Object.keys(timers).forEach((key) => {
      clearTimeout(timers[key]);
      delete timers[key];
      const notes = supplierStatesRef.current[key]?.notes ?? '';
      updateSupplierState(key, { notes });
    });
    if (activeAgent) persistUiForAgent(activeAgent);
    saveAllSupplierStatesLocal(supplierStatesRef.current);
    clearSession();
    setIsLoggedIn(false);
    setPassword('');
    setSuppliers([]);
    setFeedCursor(null);
    setFeedHasMore(false);
    setServerTabCounts(null);
    setServerFeedStats(null);
    setServerAgentStats(null);
    lastFeedKeyRef.current = '';
    feedRequestIdRef.current += 1;
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
              {LOGIN_AGENTS.map(agent => (
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

  const handleFileChange = async (phone, file) => {
    if (!file) return;
    try {
      const url = await uploadImageFile(file);
      updateSupplierState(phone, { uploadedImage: url });
    } catch (err) {
      alert(`⚠️ לא ניתן להעלות את התמונה:\n${err.message}`);
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
    irrelevant: { tab: 'הוסר', label: 'לא רלוונטי', color: '#64748b' },
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

    const key = phoneKey(phone);
    clearPendingCallOutcome(key);
    setSupplierStates((prev) => {
      const merged = { ...(prev[key] || {}), ...resetState, phone: key };
      saveSupplierStateLocal(key, merged);
      return { ...prev, [key]: merged };
    });

    fetch('/api/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: key, state: resetState }),
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
      const wasUntouchedTab = activeTab === 'לא נגעו בכלל';
      if (isReset) {
        resetSupplierToUntouched(phone);
      } else {
        updateSupplierState(phone, { status, reminder: null, agent: activeAgent });
      }
      if (wasUntouchedTab && !isReset) {
        setTimeout(() => refillUntouchedFeed(), 400);
        fetchServerStats(activeAgent);
      }
    };

    triggerSupplierMove(phone, metaKey, `${phone}-${status}`, apply);
  };

  const markSupplierIrrelevant = (phone) => {
    if (!phone) return;
    setConfirmDeleteTarget(null);
    if (selectedSupplierProfile) {
      const profilePhone = selectedSupplierProfile['Real Phone'] || selectedSupplierProfile.phone;
      if (profilePhone === phone) setSelectedSupplierProfile(null);
    }
    triggerSupplierMove(phone, 'irrelevant', `${phone}-irrelevant`, () => {
      const wasUntouchedTab = activeTab === 'לא נגעו בכלל';
      updateSupplierState(phone, {
        status: 'irrelevant',
        reminder: null,
        callbackScheduled: null,
        callbackTimestamp: null,
        agent: activeAgent,
      });
      if (wasUntouchedTab) {
        setTimeout(() => refillUntouchedFeed(), 400);
        fetchServerStats(activeAgent);
      }
    });
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

  const renderPipelineGrid = (pipeline) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
      {[
        { label: 'לא נענו', value: pipeline.noAnswer, color: '#f97316' },
        { label: 'סירבו', value: pipeline.refused, color: '#ef4444' },
        { label: 'לחזור אליהם', value: pipeline.callback, color: '#0ea5e9' },
        { label: 'הועברו הלאה', value: pipeline.forwarded, color: '#3b82f6' },
      ].map((item) => (
        <div key={item.label} className="stat-cell" style={{ textAlign: 'center', padding: '10px 6px' }}>
          <p style={{ fontSize: '1.25rem', fontWeight: '800', color: item.color, margin: 0 }}>{item.value}</p>
          <p style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {item.label}
          </p>
        </div>
      ))}
      <div
        className="stat-cell"
        style={{
          gridColumn: '1 / -1',
          textAlign: 'center',
          padding: '10px 6px',
          background: (pipeline.noStatus || 0) > 0 ? 'rgba(245, 158, 11, 0.12)' : undefined,
          border: (pipeline.noStatus || 0) > 0 ? '1px solid rgba(245, 158, 11, 0.35)' : undefined,
          borderRadius: '10px',
        }}
      >
        <p style={{
          fontSize: '1.25rem',
          fontWeight: '800',
          color: (pipeline.noStatus || 0) > 0 ? '#d97706' : '#94a3b8',
          margin: 0,
        }}>
          {pipeline.noStatus || 0}
        </p>
        <p style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', margin: '4px 0 0' }}>
          ללא סטטוס
        </p>
      </div>
    </div>
  );

  const renderCallCountRow = (counts) => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '8px',
      marginBottom: '14px',
    }}>
      {[
        { label: 'היום', value: counts.today, color: 'var(--accent-strong)' },
        { label: 'השבוע', value: counts.week, color: '#2563eb' },
        { label: 'סה"כ', value: counts.all, color: '#64748b' },
      ].map((item) => (
        <div key={item.label} className="stat-cell" style={{ textAlign: 'center', padding: '10px 6px' }}>
          <p style={{ fontSize: '1.35rem', fontWeight: '800', color: item.color, margin: 0 }}>{item.value}</p>
          <p style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            שיחות {item.label}
          </p>
        </div>
      ))}
    </div>
  );

  const renderManagerStats = () => {
    const stats = getManagerStats(supplierStates, WORKING_AGENTS);
    const callCounts = getAgentCallCounts(supplierStates, WORKING_AGENTS);

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
          {WORKING_AGENTS.map(agent => (
            <div key={agent} className="glass-card" style={{ borderTop: '4px solid var(--accent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <div style={{ width: '40px', height: '40px', background: 'var(--accent-soft)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <User size={24} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: '800' }}>סוכן: {agent}</h3>
              </div>

              <p style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--accent)', margin: '0 0 8px' }}>
                שיחות שהוצאו · לחיצה על «התקשר עכשיו»
              </p>
              {renderCallCountRow(callCounts[agent])}

              {renderStatRow('היום (24 שעות)', stats[agent].today, 'var(--accent-strong)')}
              {renderStatRow('השבוע (7 ימים)', stats[agent].week, '#2563eb')}
              {renderStatRow('סה"כ מצטבר', stats[agent].all, '#64748b')}

              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {loading ? (
                  <span style={{ color: 'var(--text-muted)' }}>טוען כיסוי פיד...</span>
                ) : (
                  <>
                    כיסוי פיד: <strong style={{ color: '#10b981' }}>{getAgentFeedStats(agent).touched}</strong>
                    {' / '}
                    {getAgentFeedStats(agent).total}
                    {' · '}
                    לא נגעו: <strong style={{ color: '#ef4444' }}>{getAgentFeedStats(agent).untouched}</strong>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAgentTargets = () => {
    if (VIEW_ALL_AGENTS.has(activeAgent)) return null;

    const feedStats = WORKING_AGENTS.includes(activeAgent)
      ? getAgentFeedStats(activeAgent)
      : null;

    const feedStatsCard = feedStats ? (
      loading ? (
        <div className="glass-card" style={{
          padding: '8px',
          marginBottom: '20px',
          border: '1px solid var(--border)',
          background: 'var(--card-bg)',
        }}>
          <LoadingSpinner size={36} label="טוען נתוני פיד..." />
        </div>
      ) : (
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
      )
    ) : null;

    const dailyTarget = 50;
    const weeklyTarget = 250;
    const dayRange = israelDayRange();
    const weekRange = israelWeekRange();

    const callsToday =
      serverAgentStats?.[activeAgent]?.calls?.today ??
      countAgentCallsBetween(supplierStates, activeAgent, dayRange.start, dayRange.end);
    const callsThisWeek =
      serverAgentStats?.[activeAgent]?.calls?.week ??
      countAgentCallsBetween(supplierStates, activeAgent, weekRange.start, weekRange.end);

    const dailyRemaining = Math.max(0, dailyTarget - callsToday);
    const dailyProgress = Math.min(100, (callsToday / dailyTarget) * 100);
    const weeklyProgress = Math.min(100, (callsThisWeek / weeklyTarget) * 100);

    const teamCallBoard = activeAgent === 'ינון' ? (
      <div className="glass-card" style={{
        padding: '18px 20px',
        marginBottom: '20px',
        border: '1px solid var(--border)',
        background: 'var(--card-bg)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: '800', color: 'var(--primary)' }}>
              מעקב הודיה וטל · היום
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              מתאפס כל יום בחצות · הועברו הלאה = עוד לא חתם
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowWeeklySummary(true)}
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              border: 'none',
              background: 'var(--accent)',
              color: 'white',
              fontWeight: '800',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            סיכום שבועי
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
          {['הודיה', 'טל'].map((agent) => {
            const callsTodayCount =
              serverAgentStats?.[agent]?.calls?.today ??
              countAgentCallsBetween(supplierStates, agent, dayRange.start, dayRange.end);
            const pipeline =
              serverAgentStats?.[agent]?.pipeline?.today ??
              getAgentPipelineStats(agent, dayRange.start, dayRange.end);
            return (
              <div key={agent} style={{
                padding: '14px',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                background: 'var(--accent-soft)',
              }}>
                <p style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: '800', color: 'var(--primary)' }}>
                  {agent}
                </p>
                <div className="stat-cell" style={{ textAlign: 'center', padding: '10px 6px', marginBottom: '8px' }}>
                  <p style={{ fontSize: '1.45rem', fontWeight: '800', color: 'var(--accent-strong)', margin: 0 }}>{callsTodayCount}</p>
                  <p style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    שיחות היום
                  </p>
                </div>
                {renderPipelineGrid(pipeline)}
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

    return (
      <div style={{ marginBottom: '30px' }} className="animate-in">
        {teamCallBoard}
        {feedStatsCard}
        <div className="glass-card" style={{ padding: '20px', borderRight: '6px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '800' }}>היעד היומי שלך (24 שעות)</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>נשארו עוד {dailyRemaining} שיחות ליעד היום</p>
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

  const getTabCounts = () => {
    if (serverTabCounts) {
      return {
        'לא נגעו בכלל': 0,
        'לחזור אליהם': 0,
        'לא ענו': 0,
        'עדיין לא חתם': 0,
        סירבו: 0,
        טופלו: 0,
        ...serverTabCounts,
      };
    }
    return {
      'לא נגעו בכלל': 0,
      'לחזור אליהם': 0,
      'לא ענו': 0,
      'עדיין לא חתם': 0,
      סירבו: 0,
      טופלו: 0,
    };
  };

  const filteredSuppliers = feedSuppliers;

  const displaySuppliers = filteredSuppliers;
  const displayList = buildDisplayList(filteredSuppliers, activeAgent, isSearchMode ? effectiveSearchQuery : '');
  const tabCounts = getTabCounts();
  const yinonGroupCounts = YINON_WORK_GROUPS.reduce((result, group) => {
    result[group.id] =
      group.id === yinonWorkGroup && serverFeedStats ? serverFeedStats.total : null;
    return result;
  }, {});

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
              {LOGIN_AGENTS.map(agent => (
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
      <AnimatePresence>
        {confirmDeleteTarget && (
          <div
            style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '20px'
            }}
            onClick={() => setConfirmDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="glass-card"
              style={{ maxWidth: '460px', width: '100%', textAlign: 'center', padding: '36px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: '#fee2e2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 18px',
              }}>
                <Trash2 size={26} />
              </div>
              <h2 style={{ fontSize: '1.45rem', fontWeight: '800', marginBottom: '10px', color: 'var(--primary)' }}>
                למחוק את הספק?
              </h2>
              <p style={{ fontSize: '1rem', lineHeight: '1.6', marginBottom: '8px', color: 'var(--text)' }}>
                הספק <strong>{confirmDeleteTarget.name}</strong> יוסר מהדשבורד ולא יופיע יותר אצל אף סוכן.
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '28px' }}>
                המחיקה רכה — אפשר לשחזר בעתיד אם צריך.
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTarget(null)}
                  className="btn-primary"
                  style={{ flex: 1, background: '#e2e8f0', color: '#0f172a', boxShadow: 'none' }}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  onClick={() => markSupplierIrrelevant(confirmDeleteTarget.phone)}
                  className="btn-primary"
                  style={{ flex: 1, background: '#dc2626' }}
                >
                  כן, מחק
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* חובת בחירת תוצאה אחרי שיחה */}
      <AnimatePresence>
        {pendingCallOutcomes[0] && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 12000,
              padding: '20px',
              direction: 'rtl',
            }}
          >
            <motion.div
              key={pendingCallOutcomes[0].id || pendingCallOutcomes[0].phoneKey}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card"
              style={{ maxWidth: '440px', width: '100%', padding: '28px', textAlign: 'center' }}
            >
              <p style={{
                margin: '0 0 6px',
                fontSize: '0.75rem',
                fontWeight: '800',
                color: '#d97706',
                letterSpacing: '0.02em',
              }}>
                חובה לבחור תוצאה
              </p>
              <h2 style={{ fontSize: '1.35rem', fontWeight: '800', margin: '0 0 8px', color: 'var(--primary)' }}>
                מה יצא בשיחה?
              </h2>
              <p style={{ fontSize: '1rem', fontWeight: '700', margin: '0 0 6px', color: 'var(--text)' }}>
                {pendingCallOutcomes[0].name}
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 20px' }}>
                {pendingCallOutcomes[0].phone}
                {pendingCallOutcomes.length > 1
                  ? ` · עוד ${pendingCallOutcomes.length - 1} ממתינים לסטטוס`
                  : ''}
              </p>

              {!callOutcomeCallbackMode ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button
                    type="button"
                    className="status-btn warning"
                    style={{ padding: '14px 10px', fontSize: '0.9rem' }}
                    onClick={() => setStatus(pendingCallOutcomes[0].phone, 'not-available')}
                  >
                    לא ענו
                  </button>
                  <button
                    type="button"
                    className="status-btn danger"
                    style={{ padding: '14px 10px', fontSize: '0.9rem' }}
                    onClick={() => setStatus(pendingCallOutcomes[0].phone, 'not-interested')}
                  >
                    לא מעוניין
                  </button>
                  <button
                    type="button"
                    className="status-btn info"
                    style={{ padding: '14px 10px', fontSize: '0.9rem' }}
                    onClick={() => setStatus(pendingCallOutcomes[0].phone, 'not-signed')}
                  >
                    עדיין לא חתם
                  </button>
                  <button
                    type="button"
                    className="status-btn callback"
                    style={{ padding: '14px 10px', fontSize: '0.9rem' }}
                    onClick={() => setCallOutcomeCallbackMode(true)}
                  >
                    לחזור מאוחר יותר
                  </button>
                </div>
              ) : (
                <div style={{
                  background: '#f0f9ff',
                  padding: '14px',
                  borderRadius: '12px',
                  border: '1px solid #bae6fd',
                  textAlign: 'right',
                }}>
                  <button
                    type="button"
                    onClick={() => setCallOutcomeCallbackMode(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#0369a1',
                      fontWeight: '700',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      marginBottom: '10px',
                      padding: 0,
                    }}
                  >
                    ← חזרה
                  </button>
                  <p style={{ fontSize: '0.75rem', fontWeight: '800', color: '#0369a1', marginBottom: '10px' }}>
                    בחר שעה לחזרה לספק:
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                    {[
                      { label: 'עוד 30 דק׳', minutes: 30 },
                      { label: 'עוד שעה', minutes: 60 },
                      { label: 'עוד 2 שעות', minutes: 120 },
                      { label: 'מחר 9:00', minutes: minutesUntilTomorrow() },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => scheduleCallback(pendingCallOutcomes[0].phone, null, opt.minutes)}
                        style={{
                          padding: '10px 6px',
                          borderRadius: '8px',
                          border: '1px solid #bae6fd',
                          background: 'white',
                          color: '#0369a1',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          cursor: 'pointer',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

      {activeAgent === 'ינון' && shouldShowWeeklySummaryReminder() && !isWeeklySummaryDismissed(getWeeklySummaryWindow().weekKey) && !weeklySummaryDismissed && (
        <div style={{
          margin: '0 0 16px',
          padding: '14px 16px',
          borderRadius: '12px',
          background: '#0f172a',
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <div>
            <p style={{ margin: '0 0 4px', fontWeight: '800', fontSize: '0.95rem' }}>תזכורת · {getWeeklySummaryWindow().title}</p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1' }}>אפשר לפתוח ולראות כמה הודיה וטל עשו השבוע. מתאפס ביום ראשון.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setShowWeeklySummary(true)}
              style={{
                padding: '8px 14px',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--accent)',
                color: 'white',
                fontWeight: '800',
                cursor: 'pointer',
              }}
            >
              פתח סיכום
            </button>
            <button
              type="button"
              onClick={() => {
                dismissWeeklySummary(getWeeklySummaryWindow().weekKey);
                setWeeklySummaryDismissed(true);
              }}
              style={{
                padding: '8px 14px',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent',
                color: '#e2e8f0',
                fontWeight: '700',
                cursor: 'pointer',
              }}
            >
              סגור
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showWeeklySummary && activeAgent === 'ינון' && (
          <div
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 11000, padding: '20px',
            }}
            onClick={() => setShowWeeklySummary(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card"
              style={{ maxWidth: '720px', width: '100%', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const weekly = getWeeklySummaryWindow();
                return (
                  <>
                    <h2 style={{ margin: '0 0 6px', fontSize: '1.3rem', fontWeight: '800', color: 'var(--primary)' }}>
                      {weekly.title}
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      סיכום הודיה וטל לשבוע · מתאפס ביום ראשון בחצות
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                      {['הודיה', 'טל'].map((agent) => {
                        const calls =
                          serverAgentStats?.[agent]?.calls?.week ??
                          countAgentCallsBetween(supplierStates, agent, weekly.start, weekly.end);
                        const pipeline =
                          serverAgentStats?.[agent]?.pipeline?.week ??
                          getAgentPipelineStats(agent, weekly.start, weekly.end);
                        return (
                          <div key={agent} style={{
                            padding: '14px',
                            borderRadius: '12px',
                            border: '1px solid var(--border)',
                            background: 'var(--accent-soft)',
                          }}>
                            <p style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: '800', color: 'var(--primary)' }}>{agent}</p>
                            <div className="stat-cell" style={{ textAlign: 'center', padding: '10px 6px', marginBottom: '8px' }}>
                              <p style={{ fontSize: '1.45rem', fontWeight: '800', color: 'var(--accent-strong)', margin: 0 }}>{calls}</p>
                              <p style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', margin: '4px 0 0' }}>שיחות השבוע</p>
                            </div>
                            {renderPipelineGrid(pipeline)}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowWeeklySummary(false)}
                      style={{
                        marginTop: '18px',
                        width: '100%',
                        padding: '12px',
                        borderRadius: '12px',
                        border: 'none',
                        background: 'var(--primary)',
                        color: 'white',
                        fontWeight: '800',
                        cursor: 'pointer',
                      }}
                    >
                      סגור
                    </button>
                  </>
                );
              })()}
            </motion.div>
          </div>
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
                  onClick={() => recordOutboundCall(alert.phone, alert.supplierName)}
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

      {activeAgent === 'ינון' && !loading && (
        <div className="work-group-bar" role="tablist" aria-label="תחום עבודה">
          {YINON_WORK_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setYinonWorkGroup(group.id)}
              className={`work-group-btn${yinonWorkGroup === group.id ? ' active' : ''}`}
            >
              {group.label}
              {yinonGroupCounts[group.id] != null ? (
                <span className="tab-count">{yinonGroupCounts[group.id]}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {activeAgent && activeAgent !== 'נתנאל' && activeAgent !== 'מאגר כללי' && !loading && (
        <div className="tab-bar">
          {[
            { key: 'לא נגעו בכלל', label: 'לא נגעו', count: tabCounts['לא נגעו בכלל'] },
            { key: 'לחזור אליהם', label: 'לחזור', count: tabCounts['לחזור אליהם'] },
            { key: 'לא ענו', label: 'לא ענו', count: tabCounts['לא ענו'] },
            { key: 'עדיין לא חתם', label: 'לא חתם', count: tabCounts['עדיין לא חתם'] },
            { key: 'סירבו', label: 'סירבו', count: tabCounts['סירבו'] },
            { key: 'טופלו', label: 'נחתמו', count: tabCounts['טופלו'] },
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
        <LoadingSpinner size={44} label="טוען ספקים וסטטוסים..." />
      ) : (
        <>
          {/* Search */}
          <div className="search-sticky">
            <div className="search-row animate-in">
            <span className="search-icon">
              <Search size={18} />
            </span>
            <input
              type="text"
              placeholder="חפש ספק לפי שם, טלפון או מספר ספק (#)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') clearSearch();
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={clearSearch}
                aria-label="נקה חיפוש"
              >
                ✕
              </button>
            )}
            </div>
          </div>

          {isSearchMode && (
            <div className="search-hint animate-in">
              <span>
                {searchLoading
                  ? `מחפש "${searchQuery}"...`
                  : `נמצאו ${displaySuppliers.length} תוצאות עבור "${effectiveSearchQuery || searchQuery}" (מכל הלשוניות)`}
              </span>
              <button
                type="button"
                onClick={clearSearch}
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
            {isSearchMode && searchLoading && searchResults === null ? (
              <div style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '60px 20px',
                color: 'var(--text-muted)',
              }}>
                מחפש...
              </div>
            ) : feedLoading ? (
              <div style={{
                gridColumn: '1 / -1',
                padding: '60px 20px',
                textAlign: 'center',
              }}>
                <LoadingSpinner size={40} label="טוען ספקים..." />
              </div>
            ) : displaySuppliers.length === 0 ? (
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
                
                <h3 style={{ fontSize: '1.15rem', fontWeight: '800', marginBottom: '8px', color: 'var(--primary)' }}>
                  {isSearchMode ? 'לא נמצאו ספקים תואמים' : `אין ספקים בטאב "${activeTab}"`}
                </h3>
                <p style={{ fontSize: '0.9rem' }}>
                  {isSearchMode
                    ? 'נסה לחפש לפי שם אחר, מספר טלפון מלא או מספר ספק תקין.'
                    : 'עברו לטאב «לא נגעו» או נקו את החיפוש.'}
                </p>
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
                const supplierWhatsAppUrl = whatsappChatUrl(phone);
                const state = stateForAgent(phone);
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
                              src={resolveWizardImageSrc(imgUrl)}
                              alt={s['Supplier Name'] || ''}
                              loading="lazy"
                              decoding="async"
                              onLoad={(e) => handleSupplierImageLoad(s, e)}
                              onError={(e) => handleSupplierImageError(s, e)}
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
                            {s['Category'] || 'כללי'}
                          </span>
                          {WORKING_AGENTS.includes(activeAgent) && previousAgentName(stateFor(phone)) && previousAgentName(stateFor(phone)) !== activeAgent && (
                            <span className="status-pill callback">{previousAgentName(stateFor(phone))}</span>
                          )}
                          {state.status === 'contract' && <span className="status-pill contract">נחתם</span>}
                          {state.status === 'not-interested' && <span className="status-pill not-interested">לא מעוניין</span>}
                          {state.status === 'not-available' && <span className="status-pill not-available">לא ענו</span>}
                          {state.status === 'not-signed' && <span className="status-pill not-signed">לא חתם</span>}
                          {state.callbackScheduled && !['contract', 'not-interested'].includes(state.status) && (
                            <span className="status-pill callback">לחזור</span>
                          )}
                          {isSearchMode && supplierTab !== activeTab && (
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
                        onChange={(e) => draftNotes(phone, e.target.value)}
                        onBlur={(e) => commitNotes(phone, e.target.value)}
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
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTarget({
                            phone,
                            name: s['Supplier Name'] || s.clean_name || 'ספק ללא שם',
                          })}
                          className={`status-btn irrelevant${activeMoveButton === `${phone}-irrelevant` ? ' supplier-move-btn-active' : ''}`}
                        >
                          <Trash2 size={14} />
                          לא רלוונטי
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

                      <div
                        className="card-contact-row"
                        style={{ marginTop: state.status === 'closed' ? '8px' : '0' }}
                      >
                        {supplierWhatsAppUrl ? (
                          <a
                            href={supplierWhatsAppUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-whatsapp-chat"
                          >
                            <MessageCircle size={18} />
                            <span>וואטסאפ</span>
                          </a>
                        ) : null}
                        <a
                          href={`tel:${s["Real Phone"]}`}
                          className="btn-call"
                          onClick={() => recordOutboundCall(
                            s["Real Phone"] || s["phone"],
                            s["Supplier Name"] || s.clean_name
                          )}
                        >
                          <Phone size={18} />
                          <span>התקשר עכשיו</span>
                        </a>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
            {!isSearchMode && (feedHasMore || feedLoadingMore) ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '12px 0 24px' }}>
                <button
                  type="button"
                  onClick={() => loadAgentFeed({ append: true })}
                  disabled={feedLoadingMore || !feedHasMore}
                  style={{
                    padding: '12px 28px',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    background: 'var(--card-bg)',
                    color: 'var(--primary)',
                    fontWeight: 800,
                    cursor: feedLoadingMore ? 'wait' : 'pointer',
                    fontSize: '0.95rem',
                  }}
                >
                  {feedLoadingMore ? 'טוען...' : 'טען עוד'}
                </button>
              </div>
            ) : null}
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
                    src={resolveWizardImageSrc(getSupplierImage(selectedSupplierProfile))} 
                    style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--primary)' }} 
                    alt="" 
                    onLoad={(e) => handleSupplierImageLoad(selectedSupplierProfile, e)}
                    onError={(e) => handleSupplierImageError(selectedSupplierProfile, e)}
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
                          src={resolveWizardImageSrc(img)} 
                          alt="" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          onError={(e) => {
                            const next = getNextImageCandidate(selectedSupplierProfile, img);
                            if (next && next !== img) {
                              e.currentTarget.src = resolveWizardImageSrc(next);
                              return;
                            }
                            e.currentTarget.parentElement.style.display = 'none';
                          }}
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
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              zIndex: 11000, padding: '20px', overflowY: 'auto',
              WebkitOverflowScrolling: 'touch'
            }}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0 }}
              className="glass-card"
              style={{
                maxWidth: '520px',
                width: '100%',
                maxHeight: 'calc(100vh - 40px)',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                padding: '36px',
                textAlign: 'center',
                margin: 'auto',
                overscrollBehavior: 'contain'
              }}
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
                // ── Step 1: Category Picker (multi) ─────────────────────────
                <>
                  {renderWizardHeader(1, "בחר קטגוריות")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '12px', textAlign: 'center' }}>
                    אפשר לבחור כמה קטגוריות — הספק יופיע בכולן באתר
                  </p>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                    gap: '8px',
                    maxHeight: '40vh',
                    overflowY: 'auto',
                    paddingLeft: '4px',
                    marginBottom: '12px'
                  }}>
                    {FIESTA_CATEGORIES.map(cat => {
                      const selected = pushSelectedTypes.includes(cat.value);
                      return (
                      <button
                        key={cat.value}
                        type="button"
                        onClick={() => togglePushCategory(cat.value)}
                        style={{
                          padding: '12px 6px',
                          borderRadius: '12px',
                          border: selected
                            ? '2px solid var(--accent)'
                            : '1.5px solid var(--border)',
                          background: selected
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
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text)', textAlign: 'center', lineHeight: '1.2' }}>
                          {selected ? '✓ ' : ''}{cat.label}
                        </span>
                      </button>
                    );})}
                  </div>
                  {pushSelectedTypes.length > 0 && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--accent-strong)', fontWeight: 700, marginBottom: '14px', textAlign: 'center' }}>
                      נבחרו {pushSelectedTypes.length}: {pushSelectedTypes.map((t) => FIESTA_CATEGORIES.find((c) => c.value === t)?.label || t).join(' · ')}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => {
                        if (!pushSelectedTypes.length) {
                          setFiestaPushError('יש לבחור לפחות קטגוריה אחת');
                          return;
                        }
                        setFiestaPushError('');
                        setFiestaPushStep(2);
                      }}
                      className="btn-primary"
                      style={{ flex: 2, padding: '12px' }}
                    >
                      המשך
                    </button>
                    <button
                      onClick={handleSkipFiestaPush}
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit', color: '#64748b' }}
                      title="דלג על העלאה לפייסטה ושמור רק בתוך CRM"
                    >
                      דלג
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
                    {/* Multi category chips */}
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: '700', display: 'block', marginBottom: '5px' }}>
                        קטגוריות באתר Fiesta ({pushSelectedTypes.length})
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {FIESTA_CATEGORIES.map((c) => {
                          const on = pushSelectedTypes.includes(c.value);
                          return (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => togglePushCategory(c.value)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '999px',
                                border: on ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                                background: on ? 'var(--accent-soft)' : 'white',
                                color: 'var(--text)',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {on ? '✓ ' : ''}{c.label}
                            </button>
                          );
                        })}
                      </div>
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

                    {/* Region — multi-select like categories */}
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: '700', display: 'block', marginBottom: '5px' }}>
                        אזורים באתר ({pushSelectedRegions.length})
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {FIESTA_REGIONS.map((r) => {
                          const on = pushSelectedRegions.includes(r);
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => togglePushRegion(r)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '999px',
                                border: on ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                                background: on ? 'var(--accent-soft)' : 'white',
                                color: 'var(--text)',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {on ? '✓ ' : ''}{r}
                            </button>
                          );
                        })}
                      </div>
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
                <>
                  {renderWizardHeader(3, "לאילו אירועים?")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '14px', textAlign: 'center' }}>
                    בחרו לאילו אירועים הספק מתאים. אחר כך אפשר לקבוע אם המחיר זהה או שונה.
                  </p>
                  <button
                    type="button"
                    onClick={setFitsAllEvents}
                    style={{
                      width: '100%',
                      padding: '14px 12px',
                      borderRadius: '12px',
                      border: fiestaPushForm.fitsAllEvents ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                      background: fiestaPushForm.fitsAllEvents ? 'var(--accent-soft)' : 'white',
                      fontWeight: 800,
                      fontSize: '0.95rem',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      marginBottom: '14px',
                    }}
                  >
                    {fiestaPushForm.fitsAllEvents ? '✓ ' : ''}כל האירועים
                  </button>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '16px' }}>
                    {FIESTA_EVENT_TYPES.map((et) => {
                      const selected = pushSelectedEvents.includes(et);
                      return (
                        <button
                          key={et}
                          type="button"
                          onClick={() => togglePushEventType(et)}
                          style={{
                            padding: '12px 8px',
                            borderRadius: '12px',
                            border: selected ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                            background: selected ? 'var(--accent-soft)' : 'white',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            fontFamily: 'inherit',
                          }}
                        >
                          {selected ? '✓ ' : ''}{et}
                        </button>
                      );
                    })}
                  </div>
                  {needsPriceDiffChoice && (
                    <div style={{ marginBottom: '16px' }}>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '10px', textAlign: 'center', fontWeight: 700 }}>
                        האם יש הבדל במחיר בין האירועים?
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setSamePriceForEvents(true)}
                          style={{
                            padding: '12px 8px',
                            borderRadius: '12px',
                            border: fiestaPushForm.samePriceForEvents ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                            background: fiestaPushForm.samePriceForEvents ? 'var(--accent-soft)' : 'white',
                            cursor: 'pointer',
                            fontWeight: 800,
                            fontSize: '0.82rem',
                            fontFamily: 'inherit',
                          }}
                        >
                          {fiestaPushForm.samePriceForEvents ? '✓ ' : ''}אותו מחיר לכולם
                        </button>
                        <button
                          type="button"
                          onClick={() => setSamePriceForEvents(false)}
                          style={{
                            padding: '12px 8px',
                            borderRadius: '12px',
                            border: !fiestaPushForm.samePriceForEvents ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                            background: !fiestaPushForm.samePriceForEvents ? 'var(--accent-soft)' : 'white',
                            cursor: 'pointer',
                            fontWeight: 800,
                            fontSize: '0.82rem',
                            fontFamily: 'inherit',
                          }}
                        >
                          {!fiestaPushForm.samePriceForEvents ? '✓ ' : ''}מחיר שונה לכל סוג
                        </button>
                      </div>
                    </div>
                  )}
                  {fiestaPushError && fiestaPushStep === 3 ? (
                    <p style={{ color: '#dc2626', fontSize: '0.8rem', fontWeight: 700, marginBottom: '10px' }}>{fiestaPushError}</p>
                  ) : null}
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => {
                        if (!fiestaPushForm.fitsAllEvents && !pushSelectedEvents.length) {
                          setFiestaPushError('בחרו «כל האירועים» או לפחות סוג אחד');
                          return;
                        }
                        setFiestaPushError('');
                        setFiestaPushStep(4);
                      }}
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
                // ── Step 4: Pricing & Discounts ────────────────────────────
                <>
                  {renderWizardHeader(4, "תמחור ועמלות")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>

                  <div style={{ textAlign: 'right', display: 'grid', gap: '14px', marginBottom: '24px' }}>
                    {usePerEventPricing && (
                      <div style={{ display: 'grid', gap: '10px' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#166534' }}>
                          מחירון, הנחה ללקוח (%) ועמלת החברה (%) לכל סוג אירוע
                        </label>
                        {pricedEventTypes.map((et) => {
                          const row = fiestaPushForm.eventPriceRows?.[et] || emptyEventPriceRow();
                          const rowCommission = toPercent(row.commissionPercent);
                          const computed = priceProduct(row.originalPrice, row.discountPercent, rowCommission);
                          return (
                            <div key={et} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '10px', background: 'white' }}>
                              <strong style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>{et}</strong>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={row.originalPrice}
                                  onChange={(e) => updateEventPriceRow(et, { originalPrice: e.target.value })}
                                  style={{ padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.88rem', fontFamily: 'inherit' }}
                                  placeholder="מחירון ₪"
                                />
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={row.discountPercent}
                                  onChange={(e) => updateEventPriceRow(et, { discountPercent: e.target.value })}
                                  style={{ padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.88rem', fontFamily: 'inherit' }}
                                  placeholder="הנחה ללקוח %"
                                />
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={row.commissionPercent}
                                  onChange={(e) => updateEventPriceRow(et, { commissionPercent: e.target.value })}
                                  style={{ padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.88rem', fontFamily: 'inherit' }}
                                  placeholder="עמלה לחברה %"
                                />
                              </div>
                              {computed.listPrice > 0 && (
                                <div style={{ marginTop: '8px', background: '#f0fdf4', borderRadius: '6px', padding: '6px 9px', fontSize: '0.78rem', fontWeight: '700', color: '#166534' }}>
                                  ללקוח {ilsShort(computed.clientPrice)}
                                  {computed.savings > 0 ? ` · חוסך ${ilsShort(computed.savings)}` : ''}
                                  {computed.commission > 0 ? ` · לחברה ${ilsShort(computed.commission)}` : ''}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {fiestaPushError && fiestaPushStep === 4 ? (
                          <p style={{ color: '#dc2626', fontSize: '0.8rem', fontWeight: 700, margin: 0 }}>{fiestaPushError}</p>
                        ) : null}
                      </div>
                    )}

                    {!usePerEventPricing && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '4px', color: '#166534' }}>הנחה ללקוח (%)</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={fiestaPushForm.discountPercent}
                          onChange={e => setFiestaPushForm(f => ({ ...f, discountPercent: e.target.value }))}
                          style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem', fontWeight: '800' }}
                          placeholder="למשל 20"
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '4px', color: '#666' }}>עמלת Fiesta (%)</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={fiestaPushForm.commissionPercent}
                          onChange={e => setFiestaPushForm(f => ({ ...f, commissionPercent: e.target.value }))}
                          style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem', fontWeight: '800' }}
                          placeholder="למשל 15"
                        />
                      </div>
                    </div>
                    )}

                    {!usePerEventPricing && (
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '6px', color: '#555' }}>
                        איך ההנחה תוצג באתר?
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setFiestaPushForm(f => ({ ...f, discountDisplayType: 'percent' }))}
                          style={{
                            padding: '10px 8px',
                            borderRadius: '8px',
                            border: fiestaPushForm.discountDisplayType !== 'amount' ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: fiestaPushForm.discountDisplayType !== 'amount' ? 'var(--accent-soft)' : 'white',
                            fontWeight: '700',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          באחוזים
                          {pushDiscountPercent > 0 ? ` (${pushDiscountPercent}%)` : ''}
                        </button>
                        <button
                          type="button"
                          onClick={() => setFiestaPushForm(f => ({ ...f, discountDisplayType: 'amount' }))}
                          style={{
                            padding: '10px 8px',
                            borderRadius: '8px',
                            border: fiestaPushForm.discountDisplayType === 'amount' ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: fiestaPushForm.discountDisplayType === 'amount' ? 'var(--accent-soft)' : 'white',
                            fontWeight: '700',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          בסכום כסף
                          {pushBaseProduct
                            ? ` (${ilsShort(Math.max(0, Number(pushBaseProduct.originalPrice) - Number(pushBaseProduct.price)))})`
                            : ''}
                        </button>
                      </div>
                      <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#64748b', fontWeight: '600' }}>
                        החישוב תמיד לפי האחוז למעלה. הבחירה כאן רק לתגית באתר.
                      </div>
                    </div>
                    )}

                    {pushLowMargin && (
                      <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '9px 12px', fontSize: '0.8rem', fontWeight: '700', color: '#991b1b' }}>
                        הספק נשאר עם {pushNetPercent}% מהמחירון בלבד (הסף המומלץ {LOW_MARGIN_THRESHOLD_PERCENT}%).
                      </div>
                    )}

                    {/* One row per thing the supplier sells */}
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', display: 'block', marginBottom: '6px', color: '#666' }}>
                        מה הספק מוכר? הזינו מחיר מחירון, המערכת מחשבת את השאר
                      </label>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {(fiestaPushForm.products || []).map((p, index) => {
                          const row = priceProduct(p.originalPrice, pushDiscountPercent, pushCommissionPercent);
                          return (
                            <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '10px', background: 'white' }}>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                <label
                                  title={p.image ? 'החלף תמונת מוצר' : 'העלה תמונת מוצר'}
                                  style={{
                                    width: 44,
                                    height: 44,
                                    flexShrink: 0,
                                    borderRadius: '8px',
                                    border: '1.5px dashed var(--border)',
                                    background: '#f8fafc',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {p.image ? (
                                    <img
                                      src={resolveWizardImageSrc(p.image)}
                                      alt=""
                                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                  ) : (
                                    <ImageIcon size={16} color="#94a3b8" />
                                  )}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = '';
                                      if (!file) return;
                                      try {
                                        const url = await uploadImageFile(file);
                                        updatePushProduct(index, { image: url });
                                      } catch (err) {
                                        alert(`⚠️ תמונת מוצר לא הועלתה: ${err.message}`);
                                      }
                                    }}
                                  />
                                </label>
                                <input
                                  value={p.name}
                                  onChange={e => updatePushProduct(index, { name: e.target.value })}
                                  style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.88rem', fontWeight: '700', fontFamily: 'inherit' }}
                                  placeholder="שם המוצר"
                                />
                                <button
                                  onClick={() => setFiestaPushForm(f => ({ ...f, products: f.products.filter((_, i) => i !== index) }))}
                                  style={{ width: '36px', borderRadius: '8px', border: '1px solid #fecaca', background: 'white', color: '#dc2626', fontWeight: '800', cursor: 'pointer', fontFamily: 'inherit' }}
                                  title="מחק מוצר"
                                >
                                  ✕
                                </button>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={p.originalPrice}
                                  onChange={e => updatePushProduct(index, { originalPrice: e.target.value })}
                                  style={{ padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.88rem', fontFamily: 'inherit' }}
                                  placeholder="מחירון ₪"
                                />
                                <select
                                  value={p.kind || 'main'}
                                  onChange={e => updatePushProduct(index, { kind: e.target.value })}
                                  style={{ padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.85rem', fontFamily: 'inherit' }}
                                >
                                  <option value="main">חבילה</option>
                                  <option value="addon">תוספת</option>
                                </select>
                              </div>
                              {row.listPrice > 0 && (
                                <div style={{ marginTop: '8px', background: '#f0fdf4', borderRadius: '6px', padding: '6px 9px', fontSize: '0.78rem', fontWeight: '700', color: '#166534' }}>
                                  ללקוח {ilsShort(row.clientPrice)} · חוסך {ilsShort(row.savings)} · עמלה {ilsShort(row.commission)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => setFiestaPushForm(f => ({ ...f, products: [...(f.products || []), makeWizardProduct((f.products || []).length)] }))}
                        style={{ marginTop: '8px', width: '100%', padding: '9px', borderRadius: '8px', border: '1.5px dashed var(--border)', background: 'white', color: '#555', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        + הוסף מוצר
                      </button>
                    </div>

                    {pushBaseProduct && (
                      <div style={{ background: 'var(--accent-soft)', borderRadius: '8px', padding: '9px 12px', fontSize: '0.8rem', fontWeight: '700', color: 'var(--accent-strong)' }}>
                        {pushPricedProducts.length} מוצרים · הכרטיס באתר יציג {ilsShort(pushBaseProduct.price)}
                        {pushPricedProducts.filter(p => p.kind === 'main').length > 1 ? ' (החל מ־)' : ''}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => {
                        if (usePerEventPricing) {
                          const missing = pricedEventTypes.filter((et) => {
                            const row = fiestaPushForm.eventPriceRows?.[et];
                            return !toAmount(row?.originalPrice);
                          });
                          if (missing.length) {
                            setFiestaPushError(`חסר מחירון עבור: ${missing.join(', ')}`);
                            return;
                          }
                        }
                        setFiestaPushError('');
                        setFiestaPushStep(5);
                      }}
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
                // ── Step 5: Contract Upload & Status ────────────────────────────
                <>
                  {renderWizardHeader(5, "העלאת חוזה או צילום שיחה")}
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px', textAlign: 'center' }}>
                    <strong>{fiestaPushSupplier['Supplier Name']}</strong>
                  </p>

                  <div style={{ textAlign: 'right', display: 'grid', gap: '14px', marginBottom: '24px' }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                      עד 3 תמונות חוזה / צילומי מסך ({pushAgreementImages.length}/3)
                    </p>
                    {pushAgreementImages.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
                        {pushAgreementImages.map((url, idx) => (
                          <div key={`${url}-${idx}`} style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', border: '1px solid #86efac', height: '110px', background: '#f0fdf4' }}>
                            <img src={url} alt={`חוזה ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeAgreementImageAt(idx);
                              }}
                              style={{ position: 'absolute', top: 4, left: 4, background: '#ef4444', color: 'white', border: 'none', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', cursor: 'pointer' }}
                            >
                              הסר
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {pushAgreementImages.length < 3 && (
                      <div
                        className="upload-zone"
                        onClick={() => document.getElementById('modal-file-upload').click()}
                        style={{
                          border: '2.5px dashed var(--border)',
                          borderRadius: '12px',
                          padding: '24px',
                          textAlign: 'center',
                          background: 'transparent',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        <input
                          id="modal-file-upload"
                          type="file"
                          onChange={(e) => {
                            handleModalFileChange(e.target.files[0]);
                            e.target.value = '';
                          }}
                          style={{ display: 'none' }}
                          accept="image/*"
                        />
                        <div style={{ color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '10px 0' }}>
                          <Upload size={32} />
                          <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>
                            {pushAgreementImages.length ? 'הוסף תמונת חוזה נוספת' : 'לחץ כאן להעלאת חוזה או צילום מסך מוואטסאפ'}
                          </span>
                        </div>
                      </div>
                    )}

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
                      onClick={() => {
                        if (fiestaPushSupplier) {
                          const phone = fiestaPushSupplier['Real Phone'] || fiestaPushSupplier.phone || '';
                          const cachedImg =
                            phone &&
                            typeof supplierImages[phone] === 'string' &&
                            supplierImages[phone].startsWith('http')
                              ? supplierImages[phone]
                              : null;
                          const fresh = collectPushImages(fiestaPushSupplier, cachedImg);
                          setFiestaPushForm((f) => ({
                            ...f,
                            selectedImages:
                              Array.isArray(f.selectedImages) && f.selectedImages.length
                                ? f.selectedImages
                                : fresh,
                          }));
                        }
                        setFiestaPushStep(6);
                      }}
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
              ) : fiestaPushStep === 6 ? (
                // ── Step 6: Portfolio Gallery Selection ────────────────────────────
                <>
                  {renderWizardHeader(6, "בחירת תמונות גלריה")}
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
                          <WizardGalleryThumb
                            key={`${idx}-${String(imgUrl).slice(0, 40)}`}
                            imgUrl={imgUrl}
                            idx={idx}
                            onRemove={() => {
                              setFiestaPushForm(f => ({
                                ...f,
                                selectedImages: f.selectedImages.filter(url => url !== imgUrl),
                                products: (f.products || []).map((p) =>
                                  p.image === imgUrl ? { ...p, image: '' } : p
                                ),
                              }));
                            }}
                          />
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
                        לא נבחרו תמונות. אפשר להוסיף למטה, או להמשיך — האתר יציג ברירת מחדל.
                      </div>
                    )}

                    {(fiestaPushForm.products || []).some((p) => String(p.name || '').trim()) && (
                      <div style={{ marginTop: '16px' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: '800', display: 'block', marginBottom: '6px', color: '#555' }}>
                          תמונה לכל מוצר
                        </label>
                        <p style={{ margin: '0 0 10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          לחצו על תמונה מהגלריה ליד מוצר, או העלו תמונה. אם לא תבחרו — ניקח אוטומטית מהגלריה בשליחה.
                        </p>
                        <div style={{ display: 'grid', gap: '10px' }}>
                          {(fiestaPushForm.products || [])
                            .filter((p) => String(p.name || '').trim())
                            .map((p) => {
                              const productIndex = (fiestaPushForm.products || []).findIndex((x) => x.id === p.id);
                              return (
                                <div
                                  key={p.id}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: '10px',
                                    padding: '10px',
                                    background: 'white',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                    <div
                                      style={{
                                        width: 48,
                                        height: 48,
                                        borderRadius: '8px',
                                        overflow: 'hidden',
                                        border: '1px solid var(--border)',
                                        background: '#f1f5f9',
                                        flexShrink: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                      }}
                                    >
                                      {p.image ? (
                                        <img
                                          src={resolveWizardImageSrc(p.image)}
                                          alt=""
                                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                      ) : (
                                        <ImageIcon size={16} color="#94a3b8" />
                                      )}
                                    </div>
                                    <div style={{ flex: 1, fontWeight: 800, fontSize: '0.88rem' }}>{p.name}</div>
                                    {p.image ? (
                                      <button
                                        type="button"
                                        onClick={() => updatePushProduct(productIndex, { image: '' })}
                                        style={{
                                          border: 'none',
                                          background: 'transparent',
                                          color: '#64748b',
                                          fontSize: '0.75rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          fontFamily: 'inherit',
                                        }}
                                      >
                                        נקה
                                      </button>
                                    ) : null}
                                    <label
                                      style={{
                                        fontSize: '0.72rem',
                                        fontWeight: 800,
                                        color: 'var(--accent-strong)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      העלה
                                      <input
                                        type="file"
                                        accept="image/*"
                                        style={{ display: 'none' }}
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          e.target.value = '';
                                          if (!file) return;
                                          try {
                                            const url = await uploadImageFile(file);
                                            setFiestaPushForm((f) => ({
                                              ...f,
                                              products: (f.products || []).map((x, i) =>
                                                i === productIndex ? { ...x, image: url } : x
                                              ),
                                              selectedImages: (f.selectedImages || []).includes(url)
                                                ? f.selectedImages
                                                : [...(f.selectedImages || []), url],
                                            }));
                                          } catch (err) {
                                            alert(`⚠️ תמונת מוצר לא הועלתה: ${err.message}`);
                                          }
                                        }}
                                      />
                                    </label>
                                  </div>
                                  {(fiestaPushForm.selectedImages || []).length > 0 && (
                                    <div
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(6, 1fr)',
                                        gap: '6px',
                                      }}
                                    >
                                      {(fiestaPushForm.selectedImages || []).map((imgUrl) => {
                                        const selected = p.image === imgUrl;
                                        return (
                                          <button
                                            key={imgUrl}
                                            type="button"
                                            onClick={() => updatePushProduct(productIndex, { image: imgUrl })}
                                            style={{
                                              padding: 0,
                                              border: selected
                                                ? '2px solid var(--accent)'
                                                : '1px solid var(--border)',
                                              borderRadius: '6px',
                                              overflow: 'hidden',
                                              cursor: 'pointer',
                                              aspectRatio: '1',
                                              background: '#e2e8f0',
                                            }}
                                            title="בחר לתמונת מוצר"
                                          >
                                            <img
                                              src={resolveWizardImageSrc(imgUrl)}
                                              alt=""
                                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                            />
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
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
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (!files.length) return;
                          for (const file of files) {
                            try {
                              const url = await uploadImageFile(file);
                              setFiestaPushForm((f) => ({
                                ...f,
                                selectedImages: [...(f.selectedImages || []), url],
                              }));
                            } catch (err) {
                              alert(`⚠️ תמונה לא הועלתה: ${err.message}`);
                            }
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => {
                        setFiestaPushForm((f) => ({
                          ...f,
                          products: applyGalleryImagesToProducts(
                            f.products,
                            f.selectedImages || []
                          ),
                        }));
                        setFiestaPushStep(7);
                      }}
                      className="btn-primary"
                      style={{ flex: 2, padding: '12px' }}
                    >
                      המשך
                    </button>
                    <button
                      onClick={() => setFiestaPushStep(5)}
                      style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: '700', background: 'white', fontFamily: 'inherit' }}
                    >
                      חזור
                    </button>
                  </div>
                </>
              ) : (
                // ── Step 6: Confirmation & Submit ────────────────────────────
                <>
                  {renderWizardHeader(7, "אישור ושליחה")}
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
                    <div><strong>קטגוריות פייסטה:</strong> {pushSelectedTypes.map((t) => FIESTA_CATEGORIES.find(c => c.value === t)?.label || t).join(' · ') || '—'}</div>
                    <div>
                      <strong>אירועים:</strong>{' '}
                      {fiestaPushForm.fitsAllEvents
                        ? ALL_EVENTS_LABEL
                        : (pushSelectedEvents.join(' · ') || '—')}
                      {needsPriceDiffChoice
                        ? (fiestaPushForm.samePriceForEvents ? ' · אותו מחיר' : ' · מחיר לפי סוג')
                        : ''}
                    </div>
                    {usePerEventPricing && pricedEventTypes.length > 0 && (
                      <div style={{ display: 'grid', gap: '4px' }}>
                        {pricedEventTypes.map((et) => {
                          const row = fiestaPushForm.eventPriceRows?.[et] || emptyEventPriceRow();
                          const rowCommission = toPercent(row.commissionPercent || fiestaPushForm.commissionPercent);
                          const computed = priceProduct(row.originalPrice, row.discountPercent, rowCommission);
                          return (
                            <div key={et} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                              <span>{et}</span>
                              <span style={{ fontWeight: 700 }}>
                                {computed.listPrice
                                  ? `${ilsShort(computed.listPrice)} ← ${ilsShort(computed.clientPrice)} · לקוח ${toPercent(row.discountPercent)}% · חברה ${rowCommission}%`
                                  : 'חסר מחירון'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div><strong>אזורים:</strong> {pushSelectedRegions.join(' · ') || 'לא צוין'}</div>
                    <div><strong>תיאור:</strong> {(fiestaPushForm.description || '').slice(0, 120) || 'אין'}{(fiestaPushForm.description || '').length > 120 ? '…' : ''}</div>
                    {!usePerEventPricing && (
                    <div>
                      <strong>תמחור:</strong> הנחה {pushDiscountPercent}% · עמלת Fiesta {pushCommissionPercent}%
                      {' · '}
                      תגית באתר:{' '}
                      {fiestaPushForm.discountDisplayType === 'amount'
                        ? (pushBaseProduct
                          ? ilsShort(Math.max(0, Number(pushBaseProduct.originalPrice) - Number(pushBaseProduct.price)))
                          : '₪…')
                        : `${pushDiscountPercent}%`}
                    </div>
                    )}
                    {pushPricedProducts.length > 0 ? (
                      <div style={{ display: 'grid', gap: '4px', marginTop: '2px' }}>
                        {pushPricedProducts.map((p) => (
                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                              {p.image ? (
                                <img
                                  src={resolveWizardImageSrc(p.image)}
                                  alt=""
                                  style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                                />
                              ) : null}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {p.name}
                                {p.kind === 'addon' ? ' (תוספת)' : ''}
                              </span>
                            </span>
                            <span style={{ whiteSpace: 'nowrap', fontWeight: '700' }}>
                              {ilsShort(p.originalPrice)} ← {ilsShort(p.price)} · עמלה {ilsShort(p.commissionAmount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div><strong>מוצרים:</strong> לא הוזנו — הספק יוצג כ״לתיאום מחיר״</div>
                    )}
                    <div><strong>חוזה/שיחה:</strong> {pushAgreementImages.length ? `✅ ${pushAgreementImages.length} תמונות` : '❌ לא צורף'}</div>
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
                      onClick={() => setFiestaPushStep(6)}
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
