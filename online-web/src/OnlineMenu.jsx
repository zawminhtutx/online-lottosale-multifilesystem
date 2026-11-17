// Online menu — same look as the POS Dashboard (welcome card + tiles). Only Sale and Slips for
// now; add more entries to MENU_TILES as online features are needed.
import React from 'react';
import { Link } from 'react-router-dom';
import { useOnline } from './onlineContext.jsx';
import { money } from './format.js';

const MENU_TILES = [
  { to: '/terms', label: 'အရောင်း', icon: '🧾', desc: 'Sale', color: '#2563eb' },
  { to: '/slips', label: 'စလစ်များ', icon: '📝', desc: 'Slips', color: '#7c3aed' },
  { to: '/results', label: 'ပေါက်ဂဏန်း', icon: '🏆', desc: 'Win numbers', color: '#16a34a' },
  { to: '/reports', label: 'စာရင်းများ', icon: '📈', desc: 'Reports', color: '#ea580c' },
  { to: '/profile', label: 'ကိုယ်ရေးအချက်အလက်', icon: '👤', desc: 'Profile', color: '#0891b2' },
];

export default function OnlineMenu() {
  const { user } = useOnline();
  return (
    <div>
      <div className="welcome-card">
        <div>
          <h2 style={{ margin: '0 0 4px' }}>မင်္ဂလာပါ၊ {user.name} 👋</h2>
          <span style={{ opacity: 0.85, fontSize: 13.5 }}>🌐 Online Server · {user.username}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span className="machine-badge">💰 လက်ကျန် {money(user.balance)} ကျပ်</span>
          {!!user.unlimited && <span className="machine-badge">∞ အကန့်အသတ်မဲ့ ငွေစာရင်း</span>}
        </div>
      </div>

      <div className="tiles ol-menu-tiles" style={{ marginTop: 18 }}>
        {MENU_TILES.map((t) => (
          <Link key={t.to} to={t.to} className="tile" style={{ borderTop: `4px solid ${t.color}`, borderRadius: 14 }}>
            <div
              className="tile-icon"
              style={{
                width: 44, height: 44, borderRadius: '50%', background: `${t.color}22`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 8,
              }}
            >
              {t.icon}
            </div>
            <div className="tile-label">{t.label}</div>
            <div className="tile-desc">{t.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
