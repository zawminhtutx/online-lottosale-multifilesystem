// Active terms from the Online server — pick one to open its Sale page (like the POS Sale page's
// "ရောင်းမည့်အပါတ်စဥ် ရွေးပါ" picker, but as its own page).
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onlineApi } from './onlineApi.js';
import { useLive } from './onlineLive.js';
import { dateTime, isTermOpen, money, parseDate, timeLeft } from './format.js';

const gameLabel = (game) => (game === '2D3D' ? '2D·3D' : game);

export default function OnlineTermsPage() {
  const navigate = useNavigate();
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(() => {
    setError('');
    onlineApi('/terms?status=open')
      .then((rows) => { setTerms(rows); setNow(new Date()); })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(load, 60000); // fallback if the live socket is down
    const tick = setInterval(() => setNow(new Date()), 15000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [load]);

  // The admin opened / edited / closed a term: reload right away (WebSocket push).
  useLive('terms', load);

  const active = (terms ?? []).filter((t) => isTermOpen(t, now));
  // Open terms whose Ledger (betting opens) time is still ahead — shown greyed out until then.
  const upcoming = (terms ?? [])
    .filter((t) => t.open_at && now < parseDate(t.open_at) && !(t.close_at && now >= parseDate(t.close_at)))
    .reverse();

  return (
    <div className="card" style={{ maxWidth: 760, margin: '0 auto', padding: 20 }}>
      <div className="ol-card-head">
        <h2 style={{ margin: 0, fontSize: 17 }}>🟢 ရောင်းမည့်အပါတ်စဥ် ရွေးပါ</h2>
        <button type="button" className="btn secondary sm" onClick={load}>🔄 Refresh</button>
      </div>

      {error && <div className="ol-error">{error}</div>}
      {!terms && !error && <div className="center-note">Loading...</div>}

      {terms && (active.length || upcoming.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map((t) => {
            const left = timeLeft(t.close_at, now);
            return (
              <button
                key={t.id}
                type="button"
                className="btn secondary block ol-term-btn"
                onClick={() => navigate(`/sale/${t.id}`)}
              >
                <span className={`type-circle ${t.game === '3D' ? 'circle-3d' : ''}`}>{gameLabel(t.game)}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontWeight: 700 }}>{t.description}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Type: <span className="badge purple">{gameLabel(t.game)}</span>
                    {' '}· တစ်ယူနစ် {money(t.unit_price)} ကျပ်
                  </div>
                </span>
                <span style={{ textAlign: 'right', fontSize: 12.5 }}>
                  <div style={{ color: 'var(--muted)' }}>⏰ {dateTime(t.close_at)}</div>
                  {left && <div className="ol-countdown">ပိတ်ရန် {left}</div>}
                </span>
              </button>
            );
          })}
          {upcoming.map((t) => (
            <button key={t.id} type="button" className="btn secondary block ol-term-btn ol-term-upcoming" disabled>
              <span className={`type-circle ${t.game === '3D' ? 'circle-3d' : ''}`}>{gameLabel(t.game)}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontWeight: 700 }}>{t.description}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Type: <span className="badge purple">{gameLabel(t.game)}</span>
                  {' '}· တစ်ယူနစ် {money(t.unit_price)} ကျပ်
                </div>
              </span>
              <span style={{ textAlign: 'right', fontSize: 12.5 }}>
                <div style={{ color: 'var(--muted)' }}>🕘 ဖွင့်ချိန် {dateTime(t.open_at)}</div>
                <div className="ol-countdown ol-opens-in">ဖွင့်ရန် {timeLeft(t.open_at, now) ?? ''}</div>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          🔴 Active term မရှိသေးပါ။
          <div style={{ marginTop: 6, fontSize: 13 }}>နောက်အပါတ်စဥ် ဖွင့်ချိန်တွင် ပြန်လာပါ။</div>
        </div>
      ))}
    </div>
  );
}
