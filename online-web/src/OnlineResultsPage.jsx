// ပေါက်ဂဏန်း — winning numbers of recent terms (2D / 3D, plus the Twod numbers of 3D results),
// marking the terms where the signed-in user won.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { onlineApi } from './onlineApi.js';
import { GAME_LABEL, dateTime, money, twodNumbers } from './format.js';

const FILTERS = [['', 'အားလုံး'], ['2D', '2D'], ['3D', '3D']];

export default function OnlineResultsPage() {
  const [game, setGame] = useState('');
  const [terms, setTerms] = useState(null);
  const [wins, setWins] = useState(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    setTerms(null);
    setError('');
    onlineApi(`/terms/results${game ? `?game=${game}` : ''}`).then(setTerms).catch((err) => setError(err.message));
  }, [game]);

  // The user's own winnings per term (won slips only).
  useEffect(() => {
    onlineApi('/tickets?status=won&limit=500')
      .then((rows) => {
        const byTerm = new Map();
        for (const t of rows) byTerm.set(t.term_id, (byTerm.get(t.term_id) ?? 0) + t.win_amount);
        setWins(byTerm);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="ol-page">
      <div className="ol-page-head">
        <h2>🏆 ပေါက်ဂဏန်း</h2>
        <div className="ol-tabs ol-tabs-inline" role="tablist">
          {FILTERS.map(([value, label]) => (
            <button key={value} role="tab" aria-selected={game === value} className={game === value ? 'active' : ''} onClick={() => setGame(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="ol-error">{error}</div>}
      {!terms && !error && <div className="center-note">Loading...</div>}
      {terms && !terms.length && <div className="ol-empty">ထွက်ဂဏန်း မရှိသေးပါ</div>}

      {terms && terms.length > 0 && (
        <div className="ol-results-grid">
          {terms.map((term) => <ResultCard key={term.id} term={term} won={wins.get(term.id)} />)}
        </div>
      )}
    </div>
  );
}

function ResultCard({ term, won }) {
  const bySlot = useMemo(() => new Map(term.results.map((r) => [r.slot, r.value])), [term.results]);
  const r3 = bySlot.get(1);
  // 2D terms store the 2D result in slot 2; older 2D+3D terms fall back to the 3D result's last two digits.
  const r2 = bySlot.get(2) ?? (term.game === '2D3D' ? r3?.slice(1) : undefined);
  const show3 = term.game !== '2D' && r3;
  const show2 = term.game !== '3D' && r2;
  const twod = show3 ? twodNumbers(r3) : [];

  return (
    <article className={`card ol-result-card ${won ? 'won' : ''}`}>
      <header>
        <div>
          <div className="ol-result-term">{term.description}</div>
          <div className="ol-muted">{dateTime(term.draw_at || term.close_at)}</div>
        </div>
        <span className={`type-circle ${term.game === '3D' ? 'circle-3d' : ''}`}>{GAME_LABEL[term.game] ?? term.game}</span>
      </header>

      <div className="ol-result-digits">
        {show2 && <div><span>2D</span><b>{r2}</b></div>}
        {show3 && <div><span>3D</span><b>{r3}</b></div>}
      </div>

      {twod.length > 0 && (
        <div className="ol-result-twod">
          <span className="ol-muted">တွဒ်</span>
          <div>{twod.map((n) => <span key={n} className="sale-num-chip">{n}</span>)}</div>
        </div>
      )}

      <footer>
        {won
          ? <Link to="/slips" className="ol-won-link">🎉 သင်ပေါက်သည် · <b>+{money(won)}</b> ကျပ်</Link>
          : <span className={`badge ${term.status === 'settled' ? 'green' : 'orange'}`}>{term.status === 'settled' ? 'ငွေရှင်းပြီး' : 'ငွေမရှင်းရသေး'}</span>}
      </footer>
    </article>
  );
}
