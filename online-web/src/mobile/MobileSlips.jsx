// စလစ်များ — online-mobile's SlipsScreen: ဖိုင် → အပါတ်စဥ် and status filters, a totals strip, one
// glass row per slip (👁 view, 🖨 print, 📤 send). The view sheet lists the slip's lines, the term's
// result, and (as on the desktop page) can ask the admin to delete an active slip. 📝 in the app bar
// lists what the admin changed on the user's slips.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, useToast } from '../components/ui.jsx';
import { useOnline } from '../onlineContext.jsx';
import { onlineApi } from '../onlineApi.js';
import { useLive } from '../onlineLive.js';
import { TICKET_STATUS, dateTime, money } from '../format.js';
import { patternLabel } from '../patterns.js';
import { nextPrintCopy, onlineSlipText, ticketLines } from '../onlinePrint.js';
import { hasHost, printSlip } from './bridge.js';
import { shareText } from '../share.js';
import { FolderTermFilter, MEmpty, MError, MIconButton, MLoading, MScreen, MSelect, MSheet, StatusChip, matchesFolderTerm } from './MobileShell.jsx';

const STATUS_FILTERS = [['', 'အားလုံး'], ['active', 'ထိုးထား'], ['won', 'ပေါက်'], ['lost', 'မပေါက်'], ['cancelled', 'ပယ်ဖျက်']];
const COLORS = { blue: '#2563eb', green: '#059669', gray: '#64748b', red: '#dc2626' };
export const ticketStatus = (s) => { const [label, c] = TICKET_STATUS[s] ?? [s, 'gray']; return { label, color: COLORS[c] ?? '#64748b' }; };
const slipNo = (t) => `S${t.term_id}-${t.slip_no}`;

export default function MobileSlips() {
  const { user } = useOnline();
  const toast = useToast();
  const [slips, setSlips] = useState(null);
  const [terms, setTerms] = useState([]);
  const [error, setError] = useState('');
  const [folderId, setFolderId] = useState(null);
  const [termId, setTermId] = useState(null);
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState(null); // { ticket, results }
  const [showLog, setShowLog] = useState(false);
  const cache = useRef(new Map());

  const load = useCallback(() => {
    cache.current.clear();
    Promise.all([onlineApi('/tickets?limit=500'), onlineApi('/terms').catch(() => [])])
      .then(([s, t]) => { setSlips(s); setTerms(t); setError(''); })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);
  useLive('slip-cancel-requests', load);

  const ticket = async (id) => {
    if (!cache.current.has(id)) cache.current.set(id, await onlineApi(`/tickets/${id}`));
    return cache.current.get(id);
  };
  const args = (t) => ({
    ticket: t,
    term: { id: t.term_id, description: t.term_description, unit_price: t.unit_price },
    user,
    lines: ticketLines(t),
  });

  async function open(s) {
    try {
      const t = await ticket(s.id);
      const term = await onlineApi(`/terms/${t.term_id}`).catch(() => null);
      setDetail({ row: s, ticket: t, results: term?.results ?? [] });
    } catch (err) { toast(err.message, 'error'); }
  }
  async function print(s) {
    try {
      const t = await ticket(s.id);
      await printSlip({ ...args(t), copy: nextPrintCopy(t.id) });
      if (hasHost()) toast(`🖨️ Slip ${slipNo(t)} ပရင့်ထုတ်ပြီးပါပြီ`, 'success');
    } catch (err) { toast(`ပရင့်ထုတ်၍ မရပါ — ${err.message}`, 'error'); }
  }
  async function send(s) {
    try {
      const r = await shareText(onlineSlipText(args(await ticket(s.id))));
      if (r === 'copied') toast('Text ကို Copy ကူးပြီးပါပြီ — Message App တွင် Paste လုပ်ပါ', 'success');
      else if (r === 'failed') toast('ပို့ရန် မအောင်မြင်ပါ', 'error');
    } catch (err) { toast(err.message, 'error'); }
  }
  // Delete does not delete: it asks the admin, who cancels (and refunds) the slip on approval.
  async function requestDelete(s) {
    try {
      await onlineApi('/slip-cancel-requests', { method: 'POST', body: { ticket_id: s.id } });
      toast(`စလစ် ${slipNo(s)} ဖျက်ရန် admin ထံ request ပို့ပြီးပါပြီ`, 'success');
      setSlips((list) => list.map((x) => (x.id === s.id ? { ...x, cancel_request: 'pending' } : x)));
      setDetail(null);
    } catch (err) { toast(err.message, 'error'); }
  }

  const shown = (slips ?? []).filter((s) => matchesFolderTerm(s, folderId, termId) && (!status || s.status === status));
  const live = shown.filter((s) => s.status !== 'cancelled');
  const total = live.reduce((a, s) => a + Number(s.net_amount || 0), 0);
  const won = live.reduce((a, s) => a + Number(s.win_amount || 0), 0);

  let list;
  if (error && !slips) list = <MError message={error} onRetry={load} />;
  else if (!slips) list = <MLoading />;
  else if (!shown.length) list = termId == null ? <MEmpty>Slip မရှိသေးပါ</MEmpty> : null;
  else {
    list = (
      <div className="m-list m-pad-x">
        {shown.map((s) => {
          const st = ticketStatus(s.status);
          const win = Number(s.win_amount || 0);
          return (
            <div key={s.id} className="m-glass m-slip">
              <button type="button" className="m-slip-main" onClick={() => open(s)}>
                <span className="m-slip-top">
                  <b>{slipNo(s)}</b>
                  {s.status !== 'active' && <StatusChip label={st.label} color={st.color} />}
                  {s.status === 'active' && s.cancel_request === 'pending' && <StatusChip label="ဖျက်ရန် စောင့်ဆဲ" color="#ea580c" />}
                  <b className="m-right">{money(s.net_amount)}</b>
                </span>
                <span className="m-slip-sub">
                  <small>{s.term_description ?? '-'} · {dateTime(s.created_at)} · {money(s.total_units)} ယူနစ်</small>
                  {win > 0 && <b className="m-green">+{money(win)}</b>}
                </span>
              </button>
              <button type="button" className="m-row-icon" aria-label="ကြည့်ရန်" onClick={() => open(s)}>👁</button>
              <button type="button" className="m-row-icon" aria-label="ပရင့်ထုတ်ရန်" onClick={() => print(s)}>🖨️</button>
              <button type="button" className="m-row-icon" aria-label="ပို့ရန်" onClick={() => send(s)}>📤</button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <MScreen
      title="စလစ်များ"
      actions={(
        <>
          <MIconButton label="ပြင်/ဖျက် စာရင်း" onClick={() => setShowLog(true)}>📝</MIconButton>
          <span className="m-pill">{money(total)}</span>
        </>
      )}
    >
      <div className="m-pad-x m-filters">
        <FolderTermFilter rows={slips ?? []} allTerms={terms} termNameKey="term_description" folderId={folderId} termId={termId}
          onChange={(f, t) => { setFolderId(f); setTermId(t); }} />
        <MSelect label="အခြေအနေ" value={status} onChange={setStatus}>
          {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </MSelect>
        <div className="m-highlight">
          <span>စလစ် {live.length}</span>
          <span className="m-right">ထိုးငွေ {money(total)}</span>
          <b className="m-green-dark">ဆုငွေ {money(won)}</b>
        </div>
      </div>
      {list}

      {detail && (
        <SlipDetail
          {...detail}
          onClose={() => setDetail(null)}
          onPrint={() => print(detail.row)}
          onSend={() => send(detail.row)}
          onDelete={() => requestDelete(detail.row)}
        />
      )}
      {showLog && <EditLog onClose={() => setShowLog(false)} />}
    </MScreen>
  );
}

function SlipDetail({ row, ticket, results, onClose, onPrint, onSend, onDelete }) {
  const [askDelete, setAskDelete] = useState(false);
  const st = ticketStatus(ticket.status);
  const r3 = results.find((r) => Number(r.slot) === 1)?.value;
  const r2 = results.find((r) => Number(r.slot) === 2)?.value;
  const lines = linesWithWins(ticket);
  const canDelete = ticket.status === 'active' && row.cancel_request !== 'pending';
  return (
    <MSheet onClose={onClose}>
      <div className="m-detail-head">
        <b>Slip {slipNo(ticket)}</b>
        {ticket.status !== 'active' && <StatusChip label={st.label} color={st.color} />}
        <span className="m-right" />
        <button type="button" aria-label="ပရင့်ထုတ်ရန်" onClick={onPrint}>🖨️</button>
        <button type="button" aria-label="ပို့ရန်" onClick={onSend}>📤</button>
        <button type="button" aria-label="ပိတ်ရန်" onClick={onClose}>✕</button>
      </div>
      <div className="m-detail-sub">{ticket.term_description} · {dateTime(ticket.created_at)}</div>
      {(r2 || r3) && (
        <div className="m-result-boxes">
          {r2 && <div><small>2D ထွက်ဂဏန်း</small><b>{r2}</b></div>}
          {r3 && <div><small>3D ထွက်ဂဏန်း</small><b>{r3}</b></div>}
        </div>
      )}
      <div className="m-detail-th"><span>ဂဏန်း</span><span>ယူနစ်</span></div>
      <div className="m-detail-lines">
        {lines.map((l, i) => (
          <div key={i} className={`m-detail-line ${l.win > 0 ? 'won' : ''}`}>
            <span>
              <b>{l.numbers.length > 1 ? `${patternLabel(l.input)} (${l.numbers.length})` : l.input}</b>
              {l.numbers.length > 1 && <small>{l.numbers.join(' ')}</small>}
            </span>
            <span>{l.unit}</span>
          </div>
        ))}
      </div>
      <div className="m-detail-total">
        <div><span>Total</span><b>{money(ticket.gross_amount)} ကျပ်</b></div>
        {Number(ticket.win_amount) > 0 && <div className="m-green-dark"><span>ဆုငွေ</span><b>{money(ticket.win_amount)} ကျပ်</b></div>}
        {canDelete && <button type="button" className="m-danger-btn" onClick={() => setAskDelete(true)}>🗑 ဖျက်ရန် request ပို့မည်</button>}
        {ticket.status === 'active' && row.cancel_request === 'pending' && <div className="m-muted-dark">ဖျက်ရန် admin approve ကို စောင့်နေသည်</div>}
      </div>
      {askDelete && (
        <Modal
          title="စလစ် ဖျက်ရန် request ပို့မလား?"
          onClose={() => setAskDelete(false)}
          footer={<><button className="btn secondary" onClick={() => setAskDelete(false)}>No</button><button className="btn danger" onClick={onDelete}>Yes</button></>}
        >
          Admin က approve လုပ်မှသာ စလစ် {slipNo(ticket)} ပယ်ဖျက်ပြီး ငွေပြန်အမ်းပါမည်။
        </Modal>
      )}
    </MSheet>
  );
}

// The slip's lines as typed ("45R" one line) with what each won.
function linesWithWins(ticket) {
  const groups = new Map((ticket.groups ?? []).map((g) => [g.id, { input: g.input, numbers: [], unit: g.units, win: 0 }]));
  const lines = [];
  for (const item of ticket.items) {
    const group = item.group_id != null ? groups.get(item.group_id) : null;
    if (group) {
      if (!group.numbers.length) lines.push(group);
      group.numbers.push(item.number);
      group.win += Number(item.win_amount || 0);
    } else {
      lines.push({ input: item.number, numbers: [item.number], unit: item.units, win: Number(item.win_amount || 0) });
    }
  }
  return lines;
}

// ပြင်/ဖျက် စာရင်း: what the admin changed on this user's slips, newest first.
function EditLog({ onClose }) {
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { onlineApi('/tickets/edit-logs').then(setLogs).catch((err) => setError(err.message)); }, []);
  return (
    <Modal title="📝 ပြင်/ဖျက် စာရင်း" onClose={onClose} footer={<button className="btn" onClick={onClose}>OK</button>}>
      {!logs?.length && <div className="ol-muted" style={{ textAlign: 'center', padding: 16 }}>{error || (logs ? 'ပြင်ဆင်/ဖျက်ထားသော စလစ် မရှိပါ' : 'Loading...')}</div>}
      {(logs ?? []).map((l) => (
        <div key={l.id} className="m-log">
          <div className="m-log-top">
            <b>S{l.term_id}-{l.slip_no}</b>
            <span className={`badge ${l.action === 'cancel' ? 'red' : 'orange'}`}>{l.action === 'cancel' ? 'ဖျက်' : 'ပြင်'}</span>
            <small className="ol-muted">{dateTime(l.created_at)}</small>
          </div>
          <div className="ol-muted">{l.term_description}</div>
          {l.action === 'cancel' && !l.lines.length
            ? <div>စလစ် တစ်ခုလုံး</div>
            : l.lines.map((x, i) => <div key={i}><b>{x.number}</b> : {x.before} ယူနစ် → {x.after ? `${x.after} ယူနစ်` : 'ဖျက်'}</div>)}
          <div>{money(l.net_before)} → {money(l.net_after)} · ပြန်အမ်းငွေ <b className="ol-pos">+{money(l.refund)}</b></div>
        </div>
      ))}
    </Modal>
  );
}
