// "အပါတ်စဥ်ရွေးရန်" — online-mobile's ActiveTermsScreen: open terms as light cards (tap to sell),
// terms not open yet as glass cards with a lock and the time left until they open.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onlineApi } from '../onlineApi.js';
import { useLive } from '../onlineLive.js';
import { dateTime, isTermOpen, parseDate, timeLeft } from '../format.js';
import { GameCircle, MEmpty, MError, MIconButton, MLoading, MScreen } from './MobileShell.jsx';

export default function MobileTerms() {
  const navigate = useNavigate();
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const load = () => onlineApi('/terms?status=open').then((t) => { setTerms(t); setError(''); }).catch((err) => setError(err.message));
  useEffect(() => {
    load();
    let n = 0;
    const id = setInterval(() => { setNow(new Date()); if (++n % 4 === 0) load(); }, 15000);
    return () => clearInterval(id);
  }, []);
  useLive('terms', load);

  const list = terms ?? [];
  const open = list.filter((t) => isTermOpen(t, now));
  const upcoming = list.filter((t) => {
    const opens = parseDate(t.open_at);
    const closes = parseDate(t.close_at);
    return opens && now < opens && (!closes || now < closes);
  }).reverse();

  let body;
  if (error && !terms) body = <MError message={error} onRetry={load} />;
  else if (!terms) body = <MLoading />;
  else if (!open.length && !upcoming.length) body = <MEmpty><div style={{ fontSize: 48 }}>⏳</div>🔴 Active term မရှိသေးပါ — နောက်အပါတ်စဥ် ဖွင့်ချိန်တွင် ပြန်လာပါ</MEmpty>;
  else {
    body = (
      <div className="m-pad m-list">
        {open.map((t) => (
          <button key={t.id} type="button" className="m-term open" onClick={() => navigate(`/sale/${t.id}`)}>
            <GameCircle game={t.game} size={52} />
            <span className="m-term-text"><b>{t.description}</b></span>
          </button>
        ))}
        {upcoming.map((t) => (
          <div key={t.id} className="m-term">
            <GameCircle game={t.game} size={52} />
            <span className="m-term-text">
              <b>{t.description}</b>
              <small>🕘 ဖွင့်ချိန် {dateTime(t.open_at)}</small>
              <small className="m-amber">ဖွင့်ရန် {timeLeft(t.open_at, now)}</small>
            </span>
            <span className="m-lock">🔒</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <MScreen title="အပါတ်စဥ်ရွေးရန်" actions={<MIconButton label="Refresh" onClick={load}>⟳</MIconButton>}>
      {body}
    </MScreen>
  );
}
