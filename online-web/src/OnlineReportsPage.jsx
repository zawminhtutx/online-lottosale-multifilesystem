// စာရင်းများ — the signed-in user's own betting per term: slips, bet amount, commission, winnings
// and the result (win − net), with totals.
import React, { useEffect, useState } from 'react';
import { onlineApi } from './onlineApi.js';
import { GAME_LABEL, dateTime, money } from './format.js';
import { useOnline } from './onlineContext.jsx';
import { Modal, useToast } from './components/ui.jsx';
import { printImage, renderOnlineReport } from './onlinePrint.js';

const FILTERS = [['', 'အားလုံး'], ['2D', '2D'], ['3D', '3D']];
// ငွေရှင်း: terms the admin has marked settled up (squared) for me, or not yet.
const CLEARED = [['', 'အားလုံး'], ['1', 'ငွေရှင်းပြီး'], ['0', 'မရှင်းရသေး']];
// 'settled' = winnings paid (ဆုငွေရှင်းပြီး); ငွေရှင်းပြီး is the admin's squaring up (cleared_at).
const STATUS = { open: ['ဖွင့်ထား', 'blue'], closed: ['ပိတ်ပြီး', 'gray'], drawn: ['ဂဏန်းထွက်ပြီး', 'orange'], settled: ['ဆုငွေရှင်းပြီး', 'green'] };

const signed = (n) => `${n > 0 ? '+' : ''}${money(n)}`;

export default function OnlineReportsPage() {
  const [game, setGame] = useState('');
  const [cleared, setCleared] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // receipt image shown before printing
  const [printing, setPrinting] = useState(false);
  const { user } = useOnline();
  const toast = useToast();

  useEffect(() => {
    setRows(null);
    setError('');
    const query = new URLSearchParams({ ...(game && { game }), ...(cleared && { cleared }) });
    onlineApi(`/reports/mine${query.size ? `?${query}` : ''}`).then(setRows).catch((err) => setError(err.message));
  }, [game, cleared]);

  const total = (key) => (rows ?? []).reduce((s, r) => s + (r[key] ?? 0), 0);
  // Profit/loss only counts settled terms — unsettled ones have no winnings yet.
  const result = (rows ?? []).filter((r) => r.status === 'settled').reduce((s, r) => s + r.result, 0);

  // 🖨️ Print: first a preview of the receipt (this list, the filter shown); the dialog's Print button
  // then sends it to this computer's Slip Printer.
  function openPreview() {
    try {
      setPreview(renderOnlineReport({
        user,
        filterLabel: [FILTERS.find(([v]) => v === game)?.[1] ?? 'အားလုံး', cleared && CLEARED.find(([v]) => v === cleared)?.[1]].filter(Boolean).join(' · '),
        rows,
        totals: { tickets: total('tickets'), gross: total('gross'), discount: total('discount'), net: total('net'), win: total('win'), result },
        gameLabel: GAME_LABEL,
        statusLabel: Object.fromEntries(Object.entries(STATUS).map(([k, [label]]) => [k, label])),
      }));
    } catch (err) {
      toast(`ပရင့် ပုံစံ ပြင်ဆင်၍ မရပါ — ${err.message}`, 'error');
    }
  }

  async function print() {
    setPrinting(true);
    try {
      const how = await printImage(preview);
      if (how === 'direct') toast('🖨️ စာရင်းကို Printer သို့ ပို့ပြီးပါပြီ', 'success');
      setPreview(null);
    } catch (err) {
      toast(`ပရင့်ထုတ်၍ မရပါ — ${err.message}`, 'error');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="ol-page">
      <div className="ol-page-head">
        <h2>📈 စာရင်းများ</h2>
        <div className="ol-tabs ol-tabs-inline" role="tablist">
          {FILTERS.map(([value, label]) => (
            <button key={value} role="tab" aria-selected={game === value} className={game === value ? 'active' : ''} onClick={() => setGame(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ol-tabs ol-tabs-inline" role="tablist" aria-label="ငွေရှင်း">
          {CLEARED.map(([value, label]) => (
            <button key={value} role="tab" aria-selected={cleared === value} className={cleared === value ? 'active' : ''} onClick={() => setCleared(value)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn secondary sm" style={{ marginLeft: 'auto' }} disabled={!rows} onClick={openPreview}>🖨️ Print</button>
      </div>

      {error && <div className="ol-error">{error}</div>}
      {!rows && !error && <div className="center-note">Loading...</div>}

      {rows && (
        <>
          <div className="ol-report-stats">
            <Stat label="အပတ်စဉ်" value={rows.length} />
            <Stat label="စလစ်" value={money(total('tickets'))} />
            <Stat label="ထိုးငွေ (အသားတင်)" value={`${money(total('net'))} ကျပ်`} sub={total('discount') > 0 ? `ကော် ${money(total('discount'))} နုတ်ပြီး` : null} />
            <Stat label="ဆုငွေ" value={`${money(total('win'))} ကျပ်`} tone="pos" />
            <Stat label="အမြတ် / အရှုံး" value={`${signed(result)} ကျပ်`} tone={result >= 0 ? 'pos' : 'neg'} />
          </div>

          {rows.length === 0 ? (
            <div className="ol-empty">စာရင်း မရှိသေးပါ</div>
          ) : (
            <div className="card table-wrap">
              <table className="ol-table">
                <thead>
                  <tr>
                    <th>အပတ်စဉ်</th>
                    <th>အမျိုးအစား</th>
                    <th className="num">စလစ်</th>
                    <th className="num">စုစုပေါင်း</th>
                    <th className="num">ကော်</th>
                    <th className="num">ထိုးငွေ</th>
                    <th className="num">ဆုငွေ</th>
                    <th className="num">အမြတ်/အရှုံး</th>
                    <th>အခြေအနေ</th>
                    <th>ငွေရှင်း</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const [label, tone] = STATUS[r.status] ?? [r.status, 'gray'];
                    return (
                      <tr key={r.term_id}>
                        <td><b>{r.description}</b><div className="ol-muted">{dateTime(r.draw_at || r.close_at)}</div></td>
                        <td><span className="badge purple">{GAME_LABEL[r.game] ?? r.game}</span></td>
                        <td className="num">{r.tickets}</td>
                        <td className="num">{money(r.gross)}</td>
                        <td className="num">{r.discount ? money(r.discount) : '—'}</td>
                        <td className="num">{money(r.net)}</td>
                        <td className="num">{r.win ? <b className="ol-pos">{money(r.win)}</b> : '—'}</td>
                        <td className={`num ${r.status === 'settled' ? (r.result >= 0 ? 'ol-pos' : 'ol-neg') : 'ol-muted'}`}>
                          {r.status === 'settled' ? signed(r.result) : '—'}
                        </td>
                        <td><span className={`badge ${tone}`}>{label}</span></td>
                        <td>
                          {r.cleared_at
                            ? <><span className="badge green">✓ ငွေရှင်းပြီး</span><div className="ol-muted">{dateTime(r.cleared_at)}</div></>
                            : <span className="badge gray">မရှင်းရသေး</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><b>စုစုပေါင်း</b></td>
                    <td className="num"><b>{money(total('tickets'))}</b></td>
                    <td className="num"><b>{money(total('gross'))}</b></td>
                    <td className="num"><b>{money(total('discount'))}</b></td>
                    <td className="num"><b>{money(total('net'))}</b></td>
                    <td className="num"><b className="ol-pos">{money(total('win'))}</b></td>
                    <td className={`num ${result >= 0 ? 'ol-pos' : 'ol-neg'}`}><b>{signed(result)}</b></td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {preview && (
            <Modal
              title="🖨️ ပရင့် ပုံစံ"
              onClose={() => setPreview(null)}
              footer={(
                <>
                  <button className="btn secondary" onClick={() => setPreview(null)}>Cancel</button>
                  <button className="btn" autoFocus disabled={printing} onClick={print}>{printing ? 'ပို့နေသည်...' : '🖨️ Print'}</button>
                </>
              )}
            >
              <div className="report-preview"><img src={preview} alt="စာရင်း ပရင့် ပုံစံ" /></div>
            </Modal>
          )}
          <p className="ol-muted" style={{ marginTop: 10 }}>ပယ်ဖျက်ထားသော စလစ်များ မပါဝင်ပါ။ အမြတ်/အရှုံး = ဆုငွေ − ထိုးငွေ (ဆုငွေရှင်းပြီးသော အပတ်စဉ်များ)။ ငွေရှင်း = Admin က သင်နှင့် ငွေစာရင်း ရှင်းပြီးကြောင်း မှတ်ထားသည်။</p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="card ol-stat">
      <span className="ol-muted">{label}</span>
      <b className={tone === 'pos' ? 'ol-pos' : tone === 'neg' ? 'ol-neg' : ''}>{value}</b>
      {sub && <small className="ol-muted">{sub}</small>}
    </div>
  );
}
