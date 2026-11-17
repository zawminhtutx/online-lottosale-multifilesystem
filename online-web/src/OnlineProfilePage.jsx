// The signed-in user's own profile (read-only — agents/admins edit account details), a
// change-password form and the wallet: balance, ငွေဖြည့် / ငွေထုတ် requests and history.
import React, { useEffect, useState } from 'react';
import { useToast } from './components/ui.jsx';
import { useOnline } from './onlineContext.jsx';
import { onlineApi } from './onlineApi.js';
import { dateTime, money } from './format.js';
import OnlineWalletCard from './OnlineWalletCard.jsx';

export default function OnlineProfilePage() {
  const { user, refreshMe } = useOnline();
  useEffect(() => { refreshMe().catch(() => {}); }, [refreshMe]);

  const rows = [
    ['အသုံးပြုသူအမည်', user.username],
    ['အမည်', user.name],
    ['မြန်မာအမည်', user.name_mm || '—'],
    ['ဖုန်း', [user.phone, user.phone2].filter(Boolean).join(' · ') || '—'],
    ['လိပ်စာ', user.address || '—'],
    ['လက်ကျန်ငွေ', (
      <span>
        <span className={user.balance < 0 ? 'ol-neg' : ''}>{money(user.balance)}</span> ကျပ်
        {!!user.unlimited && <span className="badge purple" style={{ marginLeft: 8 }}>∞ အကန့်အသတ်မဲ့</span>}
      </span>
    )],
    ['နောက်ဆုံးဝင်ချိန်', dateTime(user.last_login_at)],
    ['အကောင့်ဖွင့်ချိန်', dateTime(user.created_at)],
  ];

  return (
    <div className="ol-profile">
      <section className="card ol-card">
        <div className="ol-profile-head">
          <div className="ol-avatar" aria-hidden="true">{(user.name || user.username).slice(0, 1).toUpperCase()}</div>
          <div>
            <h2 style={{ margin: 0 }}>{user.name}</h2>
            <div className="ol-muted">@{user.username} · <span className="badge green">{user.status === 'active' ? 'အသက်ဝင်' : user.status}</span></div>
          </div>
        </div>
        <dl className="ol-profile-list">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="ol-muted" style={{ margin: '12px 0 0' }}>အမည်၊ ဖုန်း၊ လိပ်စာ ပြောင်းလိုလျှင် သင့်အေးဂျင့်ကို ဆက်သွယ်ပါ။</p>
      </section>

      <ChangePasswordCard />

      <OnlineWalletCard />
    </div>
  );
}

export function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 6) return setError('စကားဝှက်အသစ်သည် အနည်းဆုံး ၆ လုံး ဖြစ်ရမည်');
    if (next !== repeat) return setError('စကားဝှက်အသစ် နှစ်ခု မတူပါ');
    if (next === current) return setError('စကားဝှက်အသစ်သည် လက်ရှိ စကားဝှက်နှင့် မတူရပါ');
    setBusy(true);
    try {
      await onlineApi('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } });
      setCurrent(''); setNext(''); setRepeat('');
      toast('✅ စကားဝှက် ပြောင်းပြီးပါပြီ', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = (id, label, value, set, autoComplete) => (
    <div className="form-group">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="input" type="password" autoComplete={autoComplete} required value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <section className="card ol-card">
      <h2 style={{ margin: '0 0 14px' }}>🔒 စကားဝှက် ပြောင်းရန်</h2>
      <form onSubmit={submit}>
        {field('pw-current', 'လက်ရှိ စကားဝှက်', current, setCurrent, 'current-password')}
        {field('pw-new', 'စကားဝှက်အသစ် (အနည်းဆုံး ၆ လုံး)', next, setNext, 'new-password')}
        {field('pw-repeat', 'စကားဝှက်အသစ် ထပ်ရိုက်ပါ', repeat, setRepeat, 'new-password')}
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="btn block" type="submit" disabled={busy || !current || !next || !repeat}>
          {busy ? 'ပြောင်းနေသည်...' : 'စကားဝှက် ပြောင်းမည်'}
        </button>
      </form>
    </section>
  );
}
