'use client';
import { useEffect, useState } from 'react';
import { Upload, MessageCircle, Phone, Calendar, CheckCircle2, ChevronDown, User, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
  
  // Categories mapping
  const agentCategoryMap = {
    'ינון': ['מוזיקה', 'די ג\'יי', 'DJ', 'דיג\'יי', 'תקליטן'],
    'מורן': ['אולמות וגנים', 'גני אירועים', 'אולמות אירועים', 'מאפרות', 'שיער', 'כלות', 'לחתן ולכלה'],
    'הודיה': ['מאפרות', 'שיער', 'כלות', 'לחתן ולכלה'],
    'נתנאל': [] // Sees all
  };

  useEffect(() => {
    fetch('/api/suppliers')
      .then(res => res.json())
      .then(data => {
        const processedData = data.map(s => ({
          ...s,
          Category: s.Category && s.Category.trim() !== "" ? s.Category : "ספקים ללא קטגוריה"
        }));
        setSuppliers(processedData);
        const today = new Date().toISOString().split('T')[0];
        const initialStates = {};
        processedData.forEach((_, index) => {
          initialStates[index] = {
            uploadedImage: null,
            closingDate: today,
            showDatePicker: false,
            status: null,
            reminder: null,
            agent: null
          };
        });
        
        // Fetch saved states
        fetch('/api/states')
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

  const minutesUntilTomorrow = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return Math.round((tomorrow - new Date()) / 60000);
  };

  const updateSupplierState = (index, newState) => {
    setSupplierStates(prev => ({
      ...prev,
      [index]: { ...prev[index], ...newState }
    }));
    fetch('/api/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, state: newState })
    }).catch(console.error);
  };

  const scheduleCallback = (index, supplier, minutes) => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    const reminderTime = new Date(Date.now() + minutes * 60000);
    const timeStr = reminderTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    
    updateSupplierState(index, { callbackScheduled: timeStr });
    
    setActiveCallbackPicker(null);
    setTimeout(() => {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`⏰ תזכורת - ${supplier['Supplier Name']}`, {
          body: `הגיע הזמן לחזור לספק!\nטלפון: ${supplier['Real Phone']}`,
          requireInteraction: true
        });
      }
      // Send email
      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierName: supplier['Supplier Name'],
          phone: supplier['Real Phone'],
          agentName: activeAgent,
          scheduledTime: timeStr
        })
      }).catch(console.error);
      // In-app alert
      setCallbackAlerts(prev => [...prev, {
        id: Date.now(),
        supplierName: supplier['Supplier Name'],
        phone: supplier['Real Phone'],
        index
      }]);
    }, minutes * 60000);
  };


  const handleLogin = (agent) => {
    const isManager = agent === 'נתנאל';
    const isGeneral = agent === 'מאגר כללי';
    const correctPassword = isManager ? 'Dama3253!?' : 'fiestamadar';

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

  const handleFileChange = (index, file) => {
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateSupplierState(index, { uploadedImage: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDateChange = (index, date) => {
    updateSupplierState(index, { closingDate: date });
  };

  const toggleDatePicker = (index) => {
    updateSupplierState(index, { showDatePicker: !supplierStates[index].showDatePicker });
  };

  const setStatus = (index, status) => {
    updateSupplierState(index, { status, reminder: null, agent: activeAgent });
  };

  const setReminder = (index, timeText) => {
    updateSupplierState(index, { reminder: timeText, agent: activeAgent });
  };

  const addToCalendar = (index, supplier, overrideReminder = null) => {
    const state = supplierStates[index];
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

  const sendToWhatsApp = (index, supplier) => {
    const state = supplierStates[index];
    if (!state.uploadedImage) {
      alert("יש להעלות צילום מסך או חוזה לפני הדיווח!");
      return;
    }

    const phoneNumber = "0535378985";
    const closingDate = state.closingDate || new Date().toISOString().split('T')[0];
    
    const message = encodeURIComponent(
      `*דיווח סגירה* 📝\n\n` +
      `סוכן: *${activeAgent}*\n` +
      `ספק: *${supplier["Supplier Name"]}*\n` +
      `טלפון: ${supplier["Real Phone"]}\n` +
      `תאריך: ${closingDate}\n` +
      `✅ *החוזה/צילום המסך מוכנים לשליחה.*\n\n` +
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
        stats[state.agent].total++;
        if (state.status === 'closed') stats[state.agent].closed++;
        if (state.status === 'no-answer') stats[state.agent].noAnswer++;
        if (state.status === 'thinking') stats[state.agent].thinking++;
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
    
    // Count how many suppliers the current agent has acted on
    const callsDone = Object.values(supplierStates).filter(state => 
      state.agent === activeAgent && state.status !== null
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

  return (
    <div className="dashboard-container" dir="rtl">
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

      {/* Callback Alerts Banner */}
      {callbackAlerts.length > 0 && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: '10px', width: '90%', maxWidth: '500px' }}>
          {callbackAlerts.map(alert => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: 'white', padding: '16px 20px', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 8px 30px rgba(14,165,233,0.45)' }}
            >
              <div>
                <p style={{ fontWeight: '800', fontSize: '1rem', marginBottom: '2px' }}>⏰ {alert.supplierName}</p>
                <p style={{ fontSize: '0.85rem', opacity: 0.9 }}>הגיע הזמן לחזור לספק! 📞 {alert.phone}</p>
              </div>
              <button
                onClick={() => setCallbackAlerts(prev => prev.filter(a => a.id !== alert.id))}
                style={{ background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: '10px', padding: '8px 14px', color: 'white', fontWeight: '800', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                ✓
              </button>
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-muted)' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }}></div>
          טוען ספקים...
        </div>
      ) : (
        <div className="suppliers-grid">
          {suppliers
            .filter((s, i) => {
              if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') return true;
              const allowedCategories = agentCategoryMap[activeAgent] || [];
              
              // If it's a general unassigned supplier, show to everyone so they can categorize
              if (s.Category === "ספקים ללא קטגוריה" || !s.Category) return true;
              
              const matches = allowedCategories.some(cat => s.Category.includes(cat));
              if (!matches) return false;

              // Split logic for bride categories shared between Moran and Hodaya
              const brideCategories = ['מאפרות', 'שיער', 'כלות', 'לחתן ולכלה'];
              const isBrideCategory = brideCategories.some(cat => s.Category.includes(cat));
              
              if (isBrideCategory) {
                if (activeAgent === 'מורן') return i % 2 === 0;
                if (activeAgent === 'הודיה') return i % 2 === 1;
              }

              return true;
            })
            .map((s, i) => {
            const state = supplierStates[i] || { status: null };
            
            // Skip if not interested or not available
            if (state.status === 'not-interested' || state.status === 'not-available') return null;

            return (
                <motion.div 
                key={i}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-card"
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  justifyContent: 'space-between',
                  borderRight: state.status === 'not-available' ? '4px solid #f59e0b' : 
                               state.status === 'contract' ? '4px solid #10b981' : 
                               state.callbackScheduled ? '4px solid #0ea5e9' : '1px solid var(--border)'
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="category-tag">{s["Category"] || "כללי"}</span>
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
                      onClick={() => toggleDatePicker(i)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--primary)' }}
                    >
                      <Calendar size={16} />
                      <span>{state.closingDate || 'תאריך'}</span>
                    </div>
                  </div>

                  <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '6px', color: 'var(--primary)' }}>{s["Supplier Name"]}</h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>{s["Address"] || "מיקום לא צוין"}</p>
                </div>

                <div>
                  {/* Action Buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '12px' }}>
                    <button
                      onClick={() => setStatus(i, 'contract')}
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
                      onClick={() => setStatus(i, 'not-interested')}
                      style={{
                        padding: '9px 6px', borderRadius: '10px', border: '1px solid #ef4444',
                        background: 'transparent', color: '#ef4444',
                        fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer'
                      }}
                    >
                      ❌ לא מעוניין
                    </button>
                    <button
                      onClick={() => setStatus(i, 'not-available')}
                      style={{
                        padding: '9px 6px', borderRadius: '10px', border: '1px solid #f59e0b',
                        background: state.status === 'not-available' ? '#f59e0b' : 'transparent',
                        color: state.status === 'not-available' ? 'white' : '#f59e0b',
                        fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer'
                      }}
                    >
                      📵 לא זמין
                    </button>
                    <button
                      onClick={() => setActiveCallbackPicker(activeCallbackPicker === i ? null : i)}
                      style={{
                        padding: '9px 6px', borderRadius: '10px',
                        border: `1px solid ${state.callbackScheduled ? '#0ea5e9' : '#8b5cf6'}`,
                        background: state.callbackScheduled ? '#0ea5e9' : (activeCallbackPicker === i ? '#8b5cf6' : 'transparent'),
                        color: state.callbackScheduled ? 'white' : (activeCallbackPicker === i ? 'white' : '#8b5cf6'),
                        fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer'
                      }}
                    >
                      {state.callbackScheduled ? `⏰ ${state.callbackScheduled}` : '⏰ לחזור מאוחר יותר'}
                    </button>
                  </div>

                  <AnimatePresence>
                    {activeCallbackPicker === i && (
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
                              onClick={() => scheduleCallback(i, s, opt.minutes)}
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
                          onClick={() => document.getElementById(`file-${i}`).click()}
                          style={{ marginBottom: '16px', background: state.uploadedImage ? '#f0fdf4' : 'transparent', borderColor: state.uploadedImage ? '#bbf7d0' : 'var(--border)', cursor: 'pointer' }}
                        >
                          <input 
                            id={`file-${i}`}
                            type="file" 
                            onChange={(e) => handleFileChange(i, e.target.files[0])}
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
                            onClick={() => sendToWhatsApp(i, s)}
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
                          onChange={(e) => handleDateChange(i, e.target.value)}
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
          })}
        </div>
      )}

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
