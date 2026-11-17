// စလစ်များ — the online user's own slips, laid out like the POS app's Slips page: filters on the
// left, the slip table on top (View / Print / Send) and the selected slip's numbers below.
// Read-only: online slips can't be edited or deleted here. "ပြင်/ဖျက် စာရင်း" lists the changes the
// admin made to the user's slips (lines lowered / removed, slips cancelled) and the money refunded.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, useToast } from './components/ui.jsx';
import { useOnline } from './onlineContext.jsx';
import { onlineApi } from './onlineApi.js';
import { useLive } from './onlineLive.js';
import { TICKET_STATUS, money, parseDate } from './format.js';
import { nextPrintCopy, onlineSlipBlob, onlineSlipText, printCopies, printOnlineSlip, ticketLines } from './onlinePrint.js';
import { downloadBlob, shareImage, shareText } from './share.js';

const STATUS_FILTERS = [['', 'အားလုံး'], ['active', 'ထိုးထား'], ['won', 'ပေါက်'], ['lost', 'မပေါက်'], ['cancelled', 'ပယ်ဖျက်']];

function fmtDateTime(v) {
  const d = parseDate(v);
  return d ? d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
}

const slipNo = (t) => `S${t.term_id}-${t.slip_no}`;

// Print / Send / View arguments for onlinePrint.js from a GET /tickets/:id result.
function slipArgs(ticket, user, copy) {
  return {
    ticket,
    term: { id: ticket.term_id, description: ticket.term_description, unit_price: ticket.unit_price },
    user,
    lines: ticketLines(ticket),
    copy: Math.max(1, copy ?? printCopies(ticket.id) ?? 1),
  };
}

// The slip's numbers grouped as typed ("45R" is one row), with bet type, discount and winnings.
function detailRows(ticket) {
  const groups = new Map((ticket.groups ?? []).map((g) => [g.id, { key: `g${g.id}`, input: g.input, unit: g.units, items: [] }]));
  const rows = [];
  for (const item of ticket.items) {
    const group = item.group_id != null ? groups.get(item.group_id) : null;
    if (group) {
      if (!group.items.length) rows.push(group);
      group.items.push(item);
    } else {
      rows.push({ key: `i${item.id}`, input: item.number, unit: item.units, items: [item] });
    }
  }
  return rows.map((r) => ({
    ...r,
    type: r.items[0].bet_type,
    numbers: r.items.map((i) => i.number),
    winners: r.items.filter((i) => i.is_winner).map((i) => i.number),
    discount: r.items[0].discount,
    win: r.items.reduce((s, i) => s + (i.win_amount || 0), 0),
  }));
}

export default function OnlineSlipsPage() {
  const { user } = useOnline();
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [termId, setTermId] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);
  const [sendTarget, setSendTarget] = useState(null);
  const [viewTarget, setViewTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // 🗑 clicked: confirm the delete request
  const [showLog, setShowLog] = useState(false); // ပြင်/ဖျက် စာရင်း
  const cache = useRef(new Map());

  const loadTickets = useCallback(() => {
    onlineApi('/tickets?limit=500').then(setTickets).catch((err) => setError(err.message));
  }, []);
  useEffect(loadTickets, [loadTickets]);
  // The admin approved / rejected a delete request (or a slip changed): refresh the list.
  useLive('slip-cancel-requests', loadTickets);

  // 🗑 does not delete: it asks the admin. The slip is cancelled (and refunded) only when the admin
  // approves; until then, or if rejected, it stays valid and is settled like any other.
  async function requestDelete(t) {
    setBusyId(t.id);
    try {
      await onlineApi('/slip-cancel-requests', { method: 'POST', body: { ticket_id: t.id } });
      toast(`စလစ် ${slipNo(t)} ဖျက်ရန် admin ထံ request ပို့ပြီးပါပြီ`, 'success');
      setTickets((list) => list.map((x) => (x.id === t.id ? { ...x, cancel_request: 'pending' } : x)));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
      setDeleteTarget(null);
    }
  }

  const loadTicket = useCallback(async (id) => {
    if (!cache.current.has(id)) cache.current.set(id, await onlineApi(`/tickets/${id}`));
    return cache.current.get(id);
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    setDetail(null);
    setExpanded(new Set());
    loadTicket(selectedId).then((t) => { if (live) setDetail(t); }).catch((err) => toast(err.message, 'error'));
    return () => { live = false; };
  }, [selectedId, loadTicket, toast]);

  const terms = useMemo(() => {
    const seen = new Map();
    for (const t of tickets ?? []) if (!seen.has(t.term_id)) seen.set(t.term_id, t.term_description);
    return [...seen];
  }, [tickets]);

  const shown = (tickets ?? []).filter((t) => (!termId || String(t.term_id) === termId) && (!status || t.status === status));
  const live = shown.filter((t) => t.status !== 'cancelled');
  const sum = (key) => live.reduce((s, t) => s + (t[key] || 0), 0);

  async function printRow(row) {
    setBusyId(row.id);
    try {
      const ticket = await loadTicket(row.id);
      const copy = nextPrintCopy(row.id); // counted in this browser — printing never calls the online server
      setTickets((list) => [...list]); // refresh the Print column
      const how = await printOnlineSlip(slipArgs(ticket, user, copy));
      if (how === 'direct') toast('Slip ကို Printer သို့ ပို့ပြီးပါပြီ', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function send(kind) {
    const row = sendTarget;
    setSendTarget(null);
    setBusyId(row.id);
    try {
      const args = slipArgs(await loadTicket(row.id), user);
      const filename = `${slipNo(row)}.png`;
      if (kind === 'text') {
        const result = await shareText(onlineSlipText(args));
        if (result === 'shared') toast('Share Sheet ဖွင့်ပြီးပါပြီ', 'success');
        else if (result === 'copied') toast('Text ကို Copy ကူးပြီးပါပြီ — Message App တွင် Paste လုပ်ပါ', 'success');
        else toast('Text ပို့ရန် မအောင်မြင်ပါ', 'error');
      } else if (kind === 'save') {
        downloadBlob(await onlineSlipBlob(args), filename);
        toast('Voucher ပုံကို Save လုပ်ပြီးပါပြီ', 'success');
      } else {
        const result = await shareImage(await onlineSlipBlob(args), filename);
        if (result === 'shared') toast('Share Sheet ဖွင့်ပြီးပါပြီ', 'success');
        else if (result === 'copied') toast('Voucher ပုံကို Copy ကူးပြီးပါပြီ', 'success');
        else if (result === 'downloaded') toast('Voucher ပုံကို Download လုပ်ပြီးပါပြီ', 'success');
        else toast('Voucher ပုံ ပို့ရန် မအောင်မြင်ပါ', 'error');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const toggleExpand = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // The bottom panel follows the selection only while that slip is in the filtered list.
  const selected = shown.find((t) => t.id === selectedId);
  const rows = selected && detail?.id === selectedId ? detailRows(detail) : [];

  return (
    <div className="sale-panels slips-page">
      <div className="sale-panel sale-entry-panel">
        <div className="sale-field">
          <label>အပတ်စဉ်</label>
          <select className="sale-input" value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">အားလုံး</option>
            {terms.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="sale-field">
          <label>User</label>
          <input className="sale-input" value={user.name || user.username} disabled />
        </div>
        <div className="sale-field" style={{ flex: 1 }}>
          <label>အခြေအနေ</label>
          <select className="sale-input sale-customer-list" size={STATUS_FILTERS.length} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="ol-slips-sum">
          <div><span>စလစ်</span><b>{live.length}</b></div>
          <div><span>ထိုးငွေ</span><b>{money(sum('net_amount'))}</b></div>
          <div><span>ဆုငွေ</span><b className="ol-pos">{money(sum('win_amount'))}</b></div>
        </div>
        <button type="button" className="btn secondary block" style={{ marginTop: 8 }} onClick={() => setShowLog(true)}>📝 ပြင်/ဖျက် စာရင်း</button>
      </div>

      <div className="slips-table-col" style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minWidth: 320 }}>
        <div className="sale-panel slips-table-panel" style={{ flex: 1 }}>
          <div className="slip-banner slip-banner-amber">စလစ်</div>
          <div className="sale-table-scroll">
            <table className="sale-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Slip</th>
                  <th>အပတ်စဉ်</th>
                  <th>Total Unit</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>ဆုငွေ</th>
                  <th>Status</th>
                  <th>Slip Copy</th>
                  <th style={{ textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const [label, tone] = TICKET_STATUS[t.status] ?? [t.status, 'gray'];
                  return (
                    <tr key={t.id} className={selectedId === t.id ? 'sale-row-selected' : ''} onClick={() => setSelectedId(t.id)} style={{ cursor: 'pointer' }}>
                      <td>{fmtDateTime(t.created_at)}</td>
                      <td>{slipNo(t)}</td>
                      <td>{t.term_description}</td>
                      <td>{t.total_units}</td>
                      <td style={{ textAlign: 'right' }}>{money(t.net_amount)}</td>
                      <td style={{ textAlign: 'right' }}>{t.win_amount > 0 ? <b className="ol-pos">{money(t.win_amount)}</b> : '-'}</td>
                      <td>
                        <span className={`badge ${tone}`}>{label}</span>
                        {t.status === 'active' && t.cancel_request === 'pending' && <span className="badge orange" style={{ marginLeft: 4 }}>ဖျက်ရန် စောင့်ဆဲ</span>}
                        {t.status === 'active' && t.cancel_request === 'rejected' && <span className="badge gray" style={{ marginLeft: 4 }}>ဖျက်ခွင့် မရ</span>}
                      </td>
                      <td>{printCopies(t.id) || '-'}</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="icon-btn" title="View" disabled={busyId === t.id} onClick={() => setViewTarget(t)}>👁️</button>{' '}
                        <button type="button" className="icon-btn" title="Print" disabled={busyId === t.id} onClick={() => printRow(t)}>🖨️</button>{' '}
                        <button type="button" className="icon-btn" title="Send To" disabled={busyId === t.id} onClick={() => setSendTarget(t)}>📤</button>{' '}
                        <button
                          type="button"
                          className="icon-btn slip-delete-btn"
                          title={t.cancel_request === 'pending' ? 'ဖျက်ရန် admin approve ကို စောင့်နေသည်' : 'ဖျက်ရန် admin ထံ request ပို့မည်'}
                          disabled={busyId === t.id || t.status !== 'active' || t.cancel_request === 'pending'}
                          onClick={() => setDeleteTarget(t)}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={9} className="empty-hint" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
                      {error || (tickets ? 'စလစ် မရှိသေးပါ' : 'Loading...')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sale-panel slips-table-panel" style={{ flex: 1 }}>
          <div className="slip-banner slip-banner-purple">
            {selected ? `ထိုးထားသော ဂဏန်းများ — ${slipNo(selected)}` : 'ထိုးထားသော ဂဏန်းများ'}
          </div>
          <div className="sale-table-scroll">
            <table className="sale-table sale-table-detail">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Number</th>
                  <th>Unit</th>
                  <th>Discount</th>
                  <th>Comment</th>
                  <th style={{ textAlign: 'right' }}>ဆုငွေ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded.has(r.key);
                  return (
                    <React.Fragment key={r.key}>
                      <tr className={r.win > 0 ? 'ol-win-row' : ''}>
                        <td><span className="badge purple">{r.type}</span></td>
                        <td className="sale-num">
                          {r.numbers.length > 1 && (
                            <button type="button" className="sale-expand-btn" title="ဂဏန်းအားလုံး ကြည့်ရန်" onClick={() => toggleExpand(r.key)}>
                              {open ? '▾' : '▸'}
                            </button>
                          )}
                          {r.input}{r.numbers.length > 1 ? ` (${r.numbers.length})` : ''}
                        </td>
                        <td>{r.unit}</td>
                        <td>{r.discount ? `${r.discount}%` : '-'}</td>
                        <td>{r.input}-{r.unit}</td>
                        <td style={{ textAlign: 'right' }}>
                          {r.win > 0 ? <b className="ol-pos">{money(r.win)}</b> : '-'}
                          {r.win > 0 && r.numbers.length > 1 && <div className="ol-muted">{r.winners.join(', ')}</div>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="sale-expand-row">
                          <td colSpan={6}>
                            <div className="sale-expand-numbers">
                              {r.items.map((i) => (
                                <span key={i.id} className={`sale-num-chip ${i.is_winner ? 'ol-win-chip' : ''}`}>{i.number}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">📋 {selected ? (detail ? 'ဒီ Slip တွင် ဂဏန်း မရှိပါ' : 'Loading...') : 'အထက်က Slip တစ်ခုကို ရွေးပါ'}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {deleteTarget && (
        <Modal
          title="စလစ် ဖျက်ရန် request"
          onClose={() => setDeleteTarget(null)}
          footer={(
            <>
              <button className="btn secondary" onClick={() => setDeleteTarget(null)}>No</button>
              <button className="btn danger" autoFocus disabled={busyId === deleteTarget.id} onClick={() => requestDelete(deleteTarget)}>Yes</button>
            </>
          )}
        >
          <p>စလစ် <b>{slipNo(deleteTarget)}</b> ({money(deleteTarget.net_amount)} ကျပ်) ကို ဖျက်ရန် admin ထံ request ပို့မလား?</p>
          <p className="ol-muted">Admin approve လုပ်မှ ဖျက်ပြီး ငွေပြန်အမ်းပါမည်။ Approve မလုပ်ပါက စလစ်သည် ဆက်လက် အကျုံးဝင်ပြီး ပေါက်လျှင် အလျော်ရပါမည်။</p>
        </Modal>
      )}

      {showLog && <EditLog onClose={() => setShowLog(false)} />}

      {sendTarget && (
        <Modal title={`📤 Send — ${slipNo(sendTarget)}`} onClose={() => setSendTarget(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <button type="button" className="btn secondary block" onClick={() => send('text')}>💬 SMS</button>
            <button type="button" className="btn secondary block" onClick={() => send('image')}>🖼️ Image</button>
            <button type="button" className="btn secondary block" onClick={() => send('save')}>💾 Save</button>
          </div>
        </Modal>
      )}

      {viewTarget && (
        <SlipView row={viewTarget} user={user} loadTicket={loadTicket} onClose={() => setViewTarget(null)} onPrint={() => printRow(viewTarget)} />
      )}
    </div>
  );
}

// View: the slip image exactly as it prints, plus the term's results and this slip's totals.
function SlipView({ row, user, loadTicket, onClose, onPrint }) {
  const [ticket, setTicket] = useState(null);
  const [image, setImage] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let url;
    let live = true;
    (async () => {
      const t = await loadTicket(row.id);
      if (!live) return;
      setTicket(t);
      url = URL.createObjectURL(await onlineSlipBlob(slipArgs(t, user)));
      if (live) setImage(url); else URL.revokeObjectURL(url);
      const term = await onlineApi(`/terms/${t.term_id}`).catch(() => null);
      if (live) setResults(term?.results ?? []);
    })().catch((err) => live && setError(err.message));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [row.id, user, loadTicket]);

  const r3 = results.find((r) => r.slot === 1)?.value;
  // 2D terms have only the 2D result, 3D terms only the 3D one; older 2D+3D terms derive 2D from 3D.
  const r2 = results.find((r) => r.slot === 2)?.value ?? (ticket?.game === '2D3D' ? r3?.slice(1) : undefined);
  const [label, tone] = TICKET_STATUS[row.status] ?? [row.status, 'gray'];

  return (
    <Modal
      title={`👁️ ${slipNo(row)}`}
      onClose={onClose}
      className="ol-slip-view"
      footer={(
        <>
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn" disabled={!ticket} onClick={onPrint}>🖨️ Print</button>
        </>
      )}
    >
      {error && <div className="ol-error">{error}</div>}
      {!ticket && !error && <div className="center-note">Loading...</div>}
      {ticket && (
        <>
          <div className="ol-slip-head">
            <div>{ticket.term_description} <span className={`badge ${tone}`}>{label}</span></div>
            <div className="ol-muted">{fmtDateTime(ticket.created_at)}</div>
          </div>
          {(r3 || r2) && (
            <div className="ol-results">
              {r3 && <div><span>3D ထွက်ဂဏန်း</span><b>{r3}</b></div>}
              {r2 && <div><span>2D ထွက်ဂဏန်း</span><b>{r2}</b></div>}
            </div>
          )}
          <div className="ol-slip-image">{image ? <img src={image} alt={slipNo(row)} /> : <div className="center-note">Loading...</div>}</div>
          <div className="ol-totals">
            <div className="ol-total"><span>စုစုပေါင်း</span><b>{money(ticket.gross_amount)} ကျပ်</b></div>
            {ticket.discount_amount > 0 && <div className="ol-total"><span>ကော်မရှင်</span><b>− {money(ticket.discount_amount)} ကျပ်</b></div>}
            <div className="ol-total ol-total-main"><span>ပေးချေပြီး</span><b>{money(ticket.net_amount)} ကျပ်</b></div>
            {ticket.win_amount > 0 && <div className="ol-total ol-total-main"><span>ဆုငွေ</span><b className="ol-pos">{money(ticket.win_amount)} ကျပ်</b></div>}
          </div>
        </>
      )}
    </Modal>
  );
}

// ပြင်/ဖျက် စာရင်း: what the admin changed on this user's slips, newest first (GET /tickets/edit-logs).
function EditLog({ onClose }) {
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    onlineApi('/tickets/edit-logs').then(setLogs).catch((err) => setError(err.message));
  }, []);

  return (
    <Modal title="📝 ပြင်/ဖျက် စာရင်း" wide onClose={onClose}>
      <div className="sale-table-scroll" style={{ maxHeight: '65vh' }}>
        <table className="sale-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Slip</th>
              <th>အပတ်စဉ်</th>
              <th>ပြင်/ဖျက်</th>
              <th>ပြောင်းလဲမှု</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'right' }}>ပြန်အမ်းငွေ</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id}>
                <td>{fmtDateTime(l.created_at)}</td>
                <td>{`S${l.term_id}-${l.slip_no}`}</td>
                <td>{l.term_description}</td>
                <td>{l.action === 'cancel' ? <span className="badge red">ဖျက်</span> : <span className="badge orange">ပြင်</span>}</td>
                <td>
                  {l.action === 'cancel' && !l.lines.length
                    ? 'စလစ် တစ်ခုလုံး'
                    : l.lines.map((x, i) => (
                        <div key={i}>
                          <b>{x.number}</b> : {x.before} ယူနစ် → {x.after ? `${x.after} ယူနစ်` : 'ဖျက်'}
                        </div>
                      ))}
                </td>
                <td style={{ textAlign: 'right' }}>{money(l.net_before)} → {money(l.net_after)}</td>
                <td style={{ textAlign: 'right' }}><b className="ol-pos">+{money(l.refund)}</b></td>
              </tr>
            ))}
            {!logs?.length && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
                  {error || (logs ? 'ပြင်ဆင်/ဖျက်ထားသော စလစ် မရှိပါ' : 'Loading...')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
