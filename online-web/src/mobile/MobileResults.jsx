// 🏆 ပေါက်ဂဏန်း — online-mobile's WinNumberScreen: the winning number of each drawn / settled term
// (2D / 3D filter), the တွဒ် numbers under a 3D result, and what the user won in each term.
import React, { useEffect, useState } from 'react';
import { onlineApi } from '../onlineApi.js';
import { dateTime, money, parseDate, twodNumbers } from '../format.js';
import { GameCircle, MEmpty, MError, MIconButton, MLoading, MScreen } from './MobileShell.jsx';

export default function MobileResults() {
  const [game, setGame] = useState('');
  const [terms, setTerms] = useState(null);
  const [wins, setWins] = useState({});
  const [error, setError] = useState('');

  const load = (g = game) => {
    setTerms(null);
    Promise.all([onlineApi(`/terms/results${g ? `?game=${g}` : ''}`), onlineApi('/tickets?status=won&limit=500')])
      .then(([t, won]) => {
        const byTerm = {};
        for (const w of won) byTerm[w.term_id] = (byTerm[w.term_id] ?? 0) + Number(w.win_amount || 0);
        setTerms(t);
        setWins(byTerm);
        setError('');
      })
      .catch((err) => setError(err.message));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  let body;
  if (error) body = <MError message={error} onRetry={() => load()} />;
  else if (!terms) body = <MLoading />;
  else if (!terms.length) body = <MEmpty>ပေါက်ဂဏန်း မထွက်သေးပါ</MEmpty>;
  else {
    body = (
      <div className="m-pad-x m-list">
        {terms.map((t) => {
          const results = t.results ?? [];
          const r3 = results.find((r) => Number(r.slot) === 1)?.value;
          // 2D terms have only the 2D result; older 2D+3D terms derive it from 3D.
          const r2 = results.find((r) => Number(r.slot) === 2)?.value ?? (t.game === '2D3D' && r3 ? r3.slice(1) : null);
          const number = t.game === '3D' ? r3 : r2;
          const twod = t.game === '3D' ? twodNumbers(r3) : [];
          const win = wins[t.id] ?? 0;
          const when = t.draw_at ?? t.close_at;
          return (
            <div key={t.id} className="m-card m-result">
              <GameCircle game={t.game} size={40} />
              <span className="m-result-text">
                <b>{t.description}</b>
                {parseDate(when) && <small>{dateTime(when)}</small>}
                {twod.length > 0 && <small>တွဒ်: {twod.join(', ')}</small>}
                {win > 0 && <small className="m-green-dark"><b>🎉 သင့်ဆုငွေ {money(win)} ကျပ်</b></small>}
              </span>
              {number ? <b className="m-result-num">{number}</b> : <small className="m-muted-dark">မထည့်ရသေးပါ</small>}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <MScreen title="🏆 ပေါက်ဂဏန်း" actions={<MIconButton label="Refresh" onClick={() => load()}>⟳</MIconButton>}>
      <div className="m-pad-x m-filters">
        <div className="m-segments">
          {[['', 'အားလုံး'], ['2D', '2D'], ['3D', '3D']].map(([v, l]) => (
            <button key={v} type="button" className={game === v ? 'on' : ''} onClick={() => { setGame(v); load(v); }}>{l}</button>
          ))}
        </div>
      </div>
      {body}
    </MScreen>
  );
}
