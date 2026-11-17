// Phone dashboard — online-mobile's HomeShell: the balance card (tap: profile) and the menu tiles.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../components/ui.jsx';
import { useOnline } from '../onlineContext.jsx';
import { money } from '../format.js';
import { MIconButton, MScreen } from './MobileShell.jsx';
import { closeHost, hasHost } from './bridge.js';

const TILES = [
  { to: '/terms', label: 'အရောင်း', icon: '🎲' },
  { to: '/slips', label: 'စလစ်', icon: '🧾' },
  { to: '/reports', label: 'စာရင်းများကြည့်', icon: '📊' },
  { to: '/results', label: 'ပေါက်ဂဏန်း', icon: '🏆' },
];

export default function MobileHome() {
  const { user, refreshMe, logout } = useOnline();
  const navigate = useNavigate();
  const [askLogout, setAskLogout] = useState(false);
  useEffect(() => { refreshMe().catch(() => {}); }, [refreshMe]);

  return (
    <MScreen
      home
      title=""
      actions={(
        <>
          {hasHost() && <MIconButton label="ပိတ်ရန်" onClick={closeHost}>✕</MIconButton>}
          <MIconButton label="Refresh" onClick={() => refreshMe().catch(() => {})}>⟳</MIconButton>
          <MIconButton label="ထွက်ရန်" onClick={() => setAskLogout(true)}>⎋</MIconButton>
        </>
      )}
    >
      <div className="m-pad">
        <div className="m-brand">Online Lotto</div>
        <div className="m-brand-sub">အပါတ်စဥ်ရွေးပြီး ရောင်းပါ</div>
        <button type="button" className="m-balance" onClick={() => navigate('/profile')}>
          <span className="m-avatar">{(user.name || user.username || '?').slice(0, 1).toUpperCase()}</span>
          <span className="m-balance-who">
            <b>{user.name}</b>
            <small>@{user.username}</small>
          </span>
          <span className="m-balance-amt">
            <small>လက်ကျန်ငွေ</small>
            <b className={user.balance < 0 ? 'neg' : ''}>{money(user.balance)} ကျပ်</b>
            {!!user.unlimited && <small>∞ အကန့်အသတ်မဲ့</small>}
          </span>
        </button>
        <div className="m-tiles">
          {TILES.map((t) => (
            <button key={t.to} type="button" className="m-tile" onClick={() => navigate(t.to)}>
              <span className="m-tile-icon">{t.icon}</span>
              <b>{t.label}</b>
              <span className="m-tile-go">→</span>
            </button>
          ))}
        </div>
      </div>
      {askLogout && (
        <Modal
          title="ထွက်မှာလား?"
          onClose={() => setAskLogout(false)}
          footer={<><button className="btn secondary" onClick={() => setAskLogout(false)}>Cancel</button><button className="btn" onClick={logout}>ထွက်ရန်</button></>}
        />
      )}
    </MScreen>
  );
}
