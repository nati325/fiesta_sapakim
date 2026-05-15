'use client';
import { useEffect, useState } from 'react';
import { Upload, MessageCircle, Phone, Calendar, CheckCircle2, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './globals.css';

export default function SuppliersDashboard() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [supplierStates, setSupplierStates] = useState({});

  useEffect(() => {
    fetch('/api/suppliers')
      .then(res => res.json())
      .then(data => {
        setSuppliers(data);
        const today = new Date().toISOString().split('T')[0];
        const initialStates = {};
        data.forEach((_, index) => {
          initialStates[index] = {
            uploadedImage: null,
            closingDate: today,
            showDatePicker: false,
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

  const sendToWhatsApp = (index, supplier) => {
    const state = supplierStates[index];
    const phoneNumber = "0535378985";
    const closingDate = state.closingDate || new Date().toISOString().split('T')[0];
    
    const message = encodeURIComponent(
      `*דיווח סגירה* 📝\n\n` +
      `ספק: *${supplier["Supplier Name"]}*\n` +
      `טלפון: ${supplier["Real Phone"]}\n` +
      `תאריך: ${closingDate}\n` +
      `חוזה: ${state.uploadedImage ? '✅ צורף' : '❌ לא צורף'}\n\n` +
      `מערכת Fiesta`
    );
    
    window.open(`https://wa.me/972${phoneNumber.substring(1)}?text=${message}`, '_blank');
  };

  return (
    <div className="dashboard-container" dir="rtl">
      <header className="animate-in">
        <h1 className="logo">Fiesta</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>ניהול ודיווח סגירות ספקים</p>
      </header>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-muted)' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }}></div>
          <p>טוען נתונים...</p>
        </div>
      ) : (
        <div className="suppliers-grid">
          {suppliers.map((s, i) => {
            const state = supplierStates[i] || { uploadedImage: null, closingDate: new Date().toISOString().split('T')[0], showDatePicker: false };
            return (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="glass-card"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span className="category-tag">{s["Category"] || "כללי"}</span>
                    <div 
                      className="date-trigger" 
                      onClick={() => toggleDatePicker(i)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--primary)' }}
                    >
                      <Calendar size={16} />
                      <span>{state.closingDate || 'תאריך'}</span>
                      <ChevronDown size={14} style={{ transform: state.showDatePicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                    </div>
                  </div>

                  <AnimatePresence>
                    {state.showDatePicker && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: 'hidden', marginBottom: '16px' }}
                      >
                        <input 
                          type="date" 
                          value={state.closingDate}
                          onChange={(e) => handleDateChange(i, e.target.value)}
                          style={{ 
                            width: '100%', 
                            padding: '10px', 
                            borderRadius: '8px', 
                            border: '1px solid var(--border)',
                            fontFamily: 'inherit',
                            fontSize: '0.9rem'
                          }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '6px', color: 'var(--primary)' }}>{s["Supplier Name"]}</h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>{s["Address"] || "מיקום לא צוין"}</p>
                </div>

                <div>
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

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => sendToWhatsApp(i, s)}
                      className="btn-primary btn-whatsapp" 
                      style={{ flex: 1, padding: '12px' }}
                    >
                      <MessageCircle size={20} />
                      <span>דיווח בוואטצאפ</span>
                    </button>
                    
                    <a href={`tel:${s["Real Phone"]}`} className="btn-primary" style={{ padding: '12px' }}>
                      <Phone size={20} />
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
