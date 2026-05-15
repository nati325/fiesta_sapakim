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
  
  // Categories mapping
  const agentCategoryMap = {
    'ינון': ['די ג\'יי', 'צלמים', 'אטרקציות', 'DJ'],
    'מורן': ['אולמות וגנים', 'גני אירועים', 'אולמות אירועים'],
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
        setSupplierStates(initialStates);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const handleLogin = (agent) => {
    const isManager = agent === 'נתנאל';
    const isGeneral = agent === 'מאגר כללי';
    const correctPassword = isManager ? 'Dama3253!?' : 'fiestamadar';

    if (password === correctPassword) {
      setActiveAgent(agent);
      setIsLoggedIn(true);
      setLoginError(false);
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
              {['ינון', 'מורן', 'נתנאל', 'מאגר כללי'].map(agent => (
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
        setSupplierStates(prev => ({
          ...prev,
          [index]: { ...prev[index], uploadedImage: reader.result }
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDateChange = (index, date) => {
    setSupplierStates(prev => ({
      ...prev,
      [index]: { ...prev[index], closingDate: date }
    }));
  };

  const toggleDatePicker = (index) => {
    setSupplierStates(prev => ({
      ...prev,
      [index]: { ...prev[index], showDatePicker: !prev[index].showDatePicker }
    }));
  };

  const setStatus = (index, status) => {
    setSupplierStates(prev => ({
      ...prev,
      [index]: { ...prev[index], status, reminder: null, agent: activeAgent }
    }));
  };

  const setReminder = (index, timeText) => {
    setSupplierStates(prev => ({
      ...prev,
      [index]: { ...prev[index], reminder: timeText, agent: activeAgent }
    }));
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
      'מורן': { closed: 0, noAnswer: 0, thinking: 0, total: 0 }
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
          {['ינון', 'מורן'].map(agent => (
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

  return (
    <div className="dashboard-container" dir="rtl">
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

      <header className="animate-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <div>
          <h1 className="logo">Fiesta</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>ברוך הבא {activeAgent}, שיהיה יום עבודה פורה 🚀</p>
        </div>
        
        {/* Agent Selector & Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', background: '#e2e8f0', padding: '4px', borderRadius: '12px', gap: '4px' }}>
            {['ינון', 'מורן', 'נתנאל', 'מאגר כללי'].map(agent => (
              <button
                key={agent}
                onClick={() => setActiveAgent(agent)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: activeAgent === agent ? 'white' : 'transparent',
                  color: activeAgent === agent ? 'var(--primary)' : 'var(--text-muted)',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontSize: '0.85rem'
                }}
              >
                {agent}
              </button>
            ))}
          </div>
          <button 
            onClick={() => { setIsLoggedIn(false); setPassword(''); }}
            style={{ 
              padding: '8px', borderRadius: '50%', border: '1px solid var(--border)', 
              background: 'white', color: '#ef4444', cursor: 'pointer' 
            }}
            title="יציאה"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {activeAgent === 'נתנאל' && renderManagerStats()}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-muted)' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }}></div>
          טוען ספקים...
        </div>
      ) : (
        <div className="suppliers-grid">
          {suppliers
            .filter(s => {
              if (activeAgent === 'נתנאל' || activeAgent === 'מאגר כללי') return true;
              const allowedCategories = agentCategoryMap[activeAgent] || [];
              // If it's a general unassigned supplier, show to everyone so they can categorize
              if (s.Category === "ספקים ללא קטגוריה") return true;
              if (!s.Category) return true;
              return allowedCategories.some(cat => s.Category.includes(cat));
            })
            .map((s, i) => {
            const state = supplierStates[i] || { status: null };
            
            // Skip if not interested
            if (state.status === 'not-interested') return null;

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
                  borderRight: state.status === 'no-answer' ? '4px solid #f59e0b' : 
                               state.status === 'closed' ? '4px solid #10b981' : 
                               state.status === 'thinking' ? '4px solid #8b5cf6' : '1px solid var(--border)'
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
                  {/* Status Selection Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '12px' }}>
                    <button 
                      onClick={() => setStatus(i, 'no-answer')}
                      style={{ 
                        padding: '8px', borderRadius: '8px', border: '1px solid #f59e0b', 
                        background: state.status === 'no-answer' ? '#f59e0b' : 'transparent',
                        color: state.status === 'no-answer' ? 'white' : '#f59e0b',
                        fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer'
                      }}
                    >
                      לא ענה
                    </button>
                    <button 
                      onClick={() => setStatus(i, 'thinking')}
                      style={{ 
                        padding: '8px', borderRadius: '8px', border: '1px solid #8b5cf6', 
                        background: state.status === 'thinking' ? '#8b5cf6' : 'transparent',
                        color: state.status === 'thinking' ? 'white' : '#8b5cf6',
                        fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer'
                      }}
                    >
                      חושב על זה
                    </button>
                    <button 
                      onClick={() => setStatus(i, 'closed')}
                      style={{ 
                        padding: '8px', borderRadius: '8px', border: '1px solid #10b981', 
                        background: state.status === 'closed' ? '#10b981' : 'transparent',
                        color: state.status === 'closed' ? 'white' : '#10b981',
                        fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer'
                      }}
                    >
                      ענה ונסגר
                    </button>
                    <button 
                      onClick={() => setStatus(i, 'not-interested')}
                      style={{ 
                        padding: '8px', borderRadius: '8px', border: '1px solid #ef4444', 
                        background: 'transparent', color: '#ef4444',
                        fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer'
                      }}
                    >
                      לא מעוניין
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {state.status === 'thinking' && (
                      <motion.div
                        key="reminder-menu"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ background: '#f5f3ff', padding: '12px', borderRadius: '12px', marginBottom: '16px' }}
                      >
                        <p style={{ fontSize: '0.75rem', fontWeight: '700', color: '#6d28d9', marginBottom: '8px' }}>מתי לחזור אליו?</p>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {['עוד שעה', 'מחר', 'עוד שבוע'].map(t => (
                            <button 
                              key={t}
                              onClick={() => {
                                setReminder(i, t);
                                // Trigger calendar immediately for "one-click" experience
                                setTimeout(() => addToCalendar(i, s, t), 100);
                              }}
                              style={{ 
                                flex: 1, padding: '6px', borderRadius: '6px', border: 'none',
                                background: state.reminder === t ? '#8b5cf6' : 'white',
                                color: state.reminder === t ? 'white' : '#8b5cf6',
                                fontSize: '0.7rem', fontWeight: '600', cursor: 'pointer',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                              }}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        {state.reminder && (
                          <div style={{ marginTop: '10px' }}>
                            <button 
                              onClick={() => addToCalendar(i, s)}
                              style={{ 
                                width: '100%', padding: '10px', borderRadius: '8px', 
                                border: '1px solid #ddd6fe', background: 'white', color: '#8b5cf6', 
                                fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                              }}
                            >
                              <Calendar size={16} />
                              פתח יומן שוב
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {state.status === 'closed' && (
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
