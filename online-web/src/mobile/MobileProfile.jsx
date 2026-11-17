// ကိုယ်ရေးအချက်အလက် (opened from the dashboard's balance card) — the account card on the indigo
// look, then the same wallet (ငွေဖြည့် / ငွေထုတ်, history) and change-password cards as the desktop
// profile page, on white.
import React, { useEffect } from 'react';
import { useOnline } from '../onlineContext.jsx';
import { dateTime, money } from '../format.js';
import OnlineWalletCard from '../OnlineWalletCard.jsx';
import { ChangePasswordCard } from '../OnlineProfilePage.jsx';
import { MScreen } from './MobileShell.jsx';

export default function MobileProfile() {
  const { user, refreshMe } = useOnline();
  useEffect(() => { refreshMe().catch(() => {}); }, [refreshMe]);
  const rows = [
    ['အမည်', user.name],
    ['မြန်မာအမည်', user.name_mm || '—'],
    ['ဖုန်း', [user.phone, user.phone2].filter(Boolean).join(' · ') || '—'],
    ['လိပ်စာ', user.address || '—'],
    ['နောက်ဆုံးဝင်ချိန်', dateTime(user.last_login_at)],
    ['အကောင့်ဖွင့်ချိန်', dateTime(user.created_at)],
  ];
  return (
    <MScreen title="ကိုယ်ရေးအချက်အလက်">
      <div className="m-pad">
        <div className="m-balance static">
          <span className="m-avatar">{(user.name || user.username || '?').slice(0, 1).toUpperCase()}</span>
          <span className="m-balance-who"><b>{user.name}</b><small>@{user.username}</small></span>
          <span className="m-balance-amt">
            <small>လက်ကျန်ငွေ</small>
            <b className={user.balance < 0 ? 'neg' : ''}>{money(user.balance)} ကျပ်</b>
            {!!user.unlimited && <small>∞ အကန့်အသတ်မဲ့</small>}
          </span>
        </div>
        <dl className="m-glass m-info">
          {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        </dl>
        <p className="m-foot-note">အမည်၊ ဖုန်း၊ လိပ်စာ ပြောင်းလိုလျှင် သင့်အေးဂျင့်ကို ဆက်သွယ်ပါ။</p>
        <div className="m-white-cards">
          <OnlineWalletCard />
          <ChangePasswordCard />
        </div>
      </div>
    </MScreen>
  );
}
