// The phone Sale page — the online-mobile app's BetScreen on the web, for phones and the mini app
// (?embed=1): the slip table (စဥ် / ဂဏန်း / ယူနစ် / ပြင်/ဖျက်), the on-screen pattern keypad, and the
// total + ထိုးမည် bar. Nothing goes to the server while typing; ထိုးမည် sends the slip once and the
// server checks it then (discount, break, Max Unit, hot %, closed numbers, balance).
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Modal, useToast } from '../components/ui.jsx';
import { playSound } from '../sound.js';
import { useOnline } from '../onlineContext.jsx';
import { onlineApi } from '../onlineApi.js';
import { useLive } from '../onlineLive.js';
import { isTermOpen, money } from '../format.js';
import { patternLabel } from '../patterns.js';
import { replaceGroupedCartLine } from '../entryPatterns.js';
import { nextPrintCopy, onlineSlipText, ticketLines } from '../onlinePrint.js';
import { hasHost, printSlip, setBackHandler } from './bridge.js';
import { shareText } from '../share.js';
import { HotMarquee } from '../OnlineSalePage.jsx';
import PatternKeypad from './PatternKeypad.jsx';
import './mobile.css';

const DOCK_KEY = 'online_keypad_docked';
const readFlag = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; } };

// The typed pattern goes to the server as the line's label; the numbers are sent expanded.
const toEntries = (cart, betTypeId) => cart.map((e) => ({
  bet_type_id: betTypeId,
  input: /^[0-9A-Za-z*]{1,12}$/.test(e.key) ? e.key : e.numbers[0],
  numbers: e.numbers,
  units: e.unit,
}));

export default function MobileSalePage() {
  const { termId } = useParams();
  const { user, refreshMe, setUnsaved, guardedNavigate } = useOnline();
  const toast = useToast();

  const [term, setTerm] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [typeId, setTypeId] = useState(null);
  const [cart, setCart] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [keypadOpen, setKeypadOpen] = useState(true);
  const [docked, setDocked] = useState(() => readFlag(DOCK_KEY, true));
  const [busy, setBusy] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [editing, setEditing] = useState(null);
  const [full, setFull] = useState(null); // numbers at the break, when shown
  const [adjustments, setAdjustments] = useState(null);
  const [saveError, setSaveError] = useState('');

  const load = () => {
    setLoadError('');
    Promise.all([onlineApi(`/terms/${termId}`), onlineApi('/meta')])
      .then(([t, m]) => { setTerm(t); setMeta(m); })
      .catch((err) => setLoadError(err.message));
  };
  useEffect(() => {
    load();
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, [termId]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('terms', () => { onlineApi(`/terms/${termId}`).then(setTerm).catch(() => {}); });

  const betTypes = useMemo(() => {
    const all = meta?.bet_types ?? [];
    if (term?.game === '2D') return all.filter((bt) => bt.digits === 2);
    if (term?.game === '3D') return all.filter((bt) => bt.digits === 3);
    return all;
  }, [meta, term]);
  useEffect(() => { if (typeId == null && betTypes.length) setTypeId(betTypes[0].id); }, [betTypes, typeId]);
  const betType = betTypes.find((bt) => bt.id === typeId);
  const digits = betType?.digits ?? 2;
  const open = term ? isTermOpen(term, now) : false;
  const unitPrice = term?.unit_price ?? 0;
  const units = cart.reduce((sum, e) => sum + e.unit * e.numbers.length, 0);
  const total = units * unitPrice;

  // Leaving with lines not yet saved asks first (as on the desktop Sale page).
  useEffect(() => { setUnsaved(cart.length > 0); }, [cart.length, setUnsaved]);
  useEffect(() => () => setUnsaved(false), [setUnsaved]);
  // The phone's back button inside the host app: same as ← (asks first while lines are unsaved).
  useEffect(() => setBackHandler(() => guardedNavigate('/terms')), [guardedNavigate]);

  // From the keypad: a repeated key adds its unit to the line already there.
  function addEntries(entries) {
    if (!open) { toast('ပိတ်ချိန်ရောက်ပါပြီ — ဒီအပါတ်စဥ်အတွက် မထိုးနိုင်တော့ပါ', 'error'); return false; }
    setCart((c) => {
      const next = [...c];
      for (const e of entries) {
        const i = next.findIndex((x) => x.key === e.key);
        if (i >= 0) next[i] = { ...next[i], unit: next[i].unit + e.unit };
        else next.push({ ...e, rowId: `${Date.now()}-${Math.random()}` });
      }
      return next;
    });
    return true;
  }

  function changeType(id) {
    if (id === typeId) return;
    if (cart.length) return toast('လက်ရှိ slip ကို အရင် ထိုးပါ (သို့) ဖျက်ပါ', 'error');
    setTypeId(id);
  }

  async function submit() {
    if (busy || !cart.length || !betType) return;
    if (!isTermOpen(term, new Date())) return toast('ပိတ်ချိန်ရောက်သွားပါပြီ — ဒီအပါတ်စဥ်အတွက် မထိုးနိုင်တော့ပါ', 'error');
    setBusy(true);
    try {
      const ticket = await onlineApi('/tickets', { method: 'POST', body: { term_id: term.id, entries: toEntries(cart, betType.id) } });
      setCart([]);
      setExpanded(new Set());
      setLastTicket(ticket);
      playSound('checkOut');
      refreshMe().catch(() => {});
      toast(`Slip #${ticket.slip_no} သိမ်းပြီးပါပြီ — ${money(ticket.net_amount)} ကျပ်`, 'success');
      // Inside the host app the slip goes to its printer at once (printed there only if its "print
      // on save" setting is on). A phone browser has no such printer: 🖨️ prints on request.
      if (hasHost()) print(ticket, { auto: true });
      if (ticket.adjustments?.length) setAdjustments(ticket.adjustments);
    } catch (err) {
      playSound('brakLimit');
      setSaveError(err.message); // the server's checks (break, Max Unit, hot %, balance …)
    } finally {
      setBusy(false);
    }
  }

  const slipArgs = (ticket) => ({ ticket, term, user, lines: ticketLines(ticket) });
  async function print(ticket = lastTicket, { auto = false } = {}) {
    if (!ticket) return;
    try {
      const r = await printSlip({ ...slipArgs(ticket), copy: nextPrintCopy(ticket.id) }, { auto });
      if (hasHost() && r !== 'skipped') toast(`🖨️ Slip ${ticket.slip_no} ပရင့်ထုတ်ပြီးပါပြီ`, 'success');
    } catch (err) {
      toast(`ပရင့်ထုတ်၍ မရပါ — ${err.message}`, 'error');
    }
  }
  async function share() {
    if (!lastTicket) return;
    const r = await shareText(onlineSlipText(slipArgs(lastTicket)));
    if (r === 'copied') toast('Text ကို Copy ကူးပြီးပါပြီ — Message App တွင် Paste လုပ်ပါ', 'success');
    else if (r === 'failed') toast('ပို့ရန် မအောင်မြင်ပါ', 'error');
  }
  async function showFull() {
    try { setFull(await onlineApi(`/terms/${termId}/full-numbers`)); } catch (err) { toast(err.message, 'error'); }
  }

  function toggleDock() {
    setDocked((d) => {
      try { localStorage.setItem(DOCK_KEY, d ? '0' : '1'); } catch { /* this visit only */ }
      return !d;
    });
  }

  const header = (
    <header className="m-appbar">
      <button type="button" className="m-icon-btn" aria-label="Back" onClick={() => guardedNavigate('/terms')}>←</button>
      <b className="m-appbar-title">{term?.description ?? 'အရောင်း'}</b>
      <span className="m-pill">{money(user.balance)} Ks{user.unlimited ? ' ∞' : ''}</span>
      {/* စလစ်: the slips screen, as on the desktop banner (unsaved lines ask first). The term
          comes in live over the WebSocket, so there is no Refresh button beside it. */}
      <button type="button" className="m-pill-btn" onClick={() => guardedNavigate('/slips')}>🧾 စလစ်</button>
    </header>
  );

  if (loadError || !term || !meta) {
    return (
      <div className="m-screen">
        {header}
        <div className="m-center">
          {loadError
            ? <><div>⚠️ {loadError}</div><button className="btn" onClick={load}>ပြန်ကြိုးစားရန်</button></>
            : <div>Loading...</div>}
        </div>
      </div>
    );
  }

  const showKeypad = keypadOpen && open;
  return (
    <div className="m-screen">
      {header}
      <HotMarquee term={term} />
      {!open && <div className="m-closed">🔴 ပိတ်ချိန်ရောက်ပါပြီ — ဒီအပါတ်စဥ်အတွက် မထိုးနိုင်တော့ပါ</div>}
      <div className="m-strip">
        <span className="m-game">{term.game}</span>
        {betTypes.length > 1
          ? betTypes.map((bt) => (
            <button key={bt.id} type="button" className={`m-type ${bt.id === typeId ? 'on' : ''}`} onClick={() => changeType(bt.id)}>{bt.description}</button>
          ))
          : <b>{betType?.description}</b>}
      </div>

      <div className="m-sheet">
        <div className="m-table-head"><span>စဥ်</span><span>ဂဏန်း</span><span>ယူနစ်</span><span>ပြင်/ဖျက်</span></div>
        <div className="m-table-body">
          {!cart.length && (
            <div className="m-empty">
              <div style={{ fontSize: 44 }}>⌨️</div>
              ဂဏန်းထည့်ရန် အောက်ခြေ ခလုတ်ကို နှိပ်ပါ
            </div>
          )}
          {[...cart].reverse().map((e, i) => {
            const idx = cart.length - i;
            const group = e.numbers.length > 1;
            const label = e.grouptype != null ? patternLabel(e.key) : e.key;
            const isOpen = expanded.has(e.rowId);
            return (
              <div key={e.rowId} className={`m-row ${i % 2 ? '' : 'alt'}`}>
                <div className="m-row-main">
                  <span>{idx}</span>
                  <span
                    className="m-num"
                    onClick={group ? () => setExpanded((x) => { const n = new Set(x); if (!n.delete(e.rowId)) n.add(e.rowId); return n; }) : undefined}
                  >
                    {group && <span className="m-link">🔗</span>}
                    {group ? `${label} (${e.numbers.length})` : label}
                  </span>
                  <span className="m-num">{money(e.unit)}</span>
                  <span className="m-actions">
                    {group && (
                      <button
                        type="button"
                        className="m-ungroup"
                        aria-label="ခွဲ"
                        onClick={() => {
                          const stamp = Date.now();
                          setCart((c) => {
                            const result = replaceGroupedCartLine(c, e, digits, (i) => `u-${stamp}-${i}`);
                            return result.ok ? result.cart : c;
                          });
                          setExpanded((x) => { const n = new Set(x); n.delete(e.rowId); return n; });
                        }}
                      >
                        ခွဲ
                      </button>
                    )}
                    <button type="button" aria-label="ပြင်မည်" onClick={() => setEditing(e)}>✏️</button>
                    <button type="button" aria-label="ဖျက်မည်" onClick={() => { playSound('brakLimit'); setCart((c) => c.filter((x) => x.rowId !== e.rowId)); }}>🗑️</button>
                  </span>
                </div>
                {isOpen && <div className="m-chips">{e.numbers.map((n) => <span key={n}>{n}</span>)}</div>}
              </div>
            );
          })}
        </div>
        <div className="m-tools">
          <button type="button" disabled={!lastTicket} title="နောက်ဆုံး Slip ပို့ရန်" onClick={share}>📤</button>
          <button type="button" disabled={!lastTicket} title="နောက်ဆုံး Slip ပရင့်ထုတ်ရန်" onClick={() => print()}>🖨️</button>
          <button type="button" title="ဘရိတ်ပြည့်နေသော ဂဏန်းများ" onClick={showFull}>▦</button>
          <span className="m-units">ယူနစ် {money(units)}</span>
        </div>
        <div className="m-total">
          <span>စုစုပေါင်း</span>
          <b>{money(total)} Ks</b>
          <button type="button" className="m-submit" disabled={busy || !cart.length || !open} onClick={submit}>
            {busy ? '…' : '💾 ထိုးမည်'}
          </button>
        </div>
      </div>

      {open && !showKeypad && (
        <button type="button" className="m-fab" aria-label="Keypad" onClick={() => setKeypadOpen(true)}>⌨️</button>
      )}
      {showKeypad && !docked && <div className="m-backdrop" onClick={() => setKeypadOpen(false)} />}
      {showKeypad && (
        <div className={`m-keypad-wrap ${docked ? 'docked' : 'floating'}`}>
          <PatternKeypad
            key={digits}
            digits={digits}
            disabled={!open}
            onAdd={addEntries}
            onSave={submit}
            onShowFull={showFull}
            onHide={() => setKeypadOpen(false)}
            docked={docked}
            onToggleDock={toggleDock}
          />
        </div>
      )}

      {editing && (
        <EditUnitModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={(unit) => { setCart((c) => c.map((x) => (x.rowId === editing.rowId ? { ...x, unit } : x))); setEditing(null); }}
        />
      )}
      {full && (
        <Modal title="ဘရိတ်ပြည့်နေသော ဂဏန်းများ" onClose={() => setFull(null)} footer={<button className="btn" onClick={() => setFull(null)}>OK</button>}>
          {full.length
            ? <div className="m-full-grid">{full.map((r) => <span key={r.number}>{r.number}</span>)}</div>
            : <div className="ol-muted" style={{ textAlign: 'center' }}>မရှိပါ</div>}
        </Modal>
      )}
      {adjustments && (
        <Modal title="မရဂဏန်းများ" onClose={() => setAdjustments(null)} footer={<button className="btn" onClick={() => setAdjustments(null)}>OK</button>}>
          {adjustments.map((a) => (
            <div key={`${a.bet_type_id}:${a.number}`} style={{ padding: '3px 0' }}>
              <b>{a.number}</b> - {a.saved > 0 ? `${a.requested - a.saved} မရ` : 'မရ'}
            </div>
          ))}
        </Modal>
      )}
      {saveError && (
        <Modal title="⛔ မသိမ်းနိုင်ပါ" onClose={() => setSaveError('')} footer={<button className="btn" onClick={() => setSaveError('')}>OK</button>}>
          {saveError}
        </Modal>
      )}
    </div>
  );
}

function EditUnitModal({ entry, onClose, onSave }) {
  const [unit, setUnit] = useState(String(entry.unit));
  const save = () => { const u = Number(unit); if (Number.isInteger(u) && u > 0) onSave(u); };
  return (
    <Modal
      title={`ပြင်ရန် — ${entry.grouptype != null ? patternLabel(entry.key) : entry.key}`}
      onClose={onClose}
      onConfirm={save}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>OK</button></>}
    >
      <label className="field-label">ယူနစ်</label>
      <input className="input" autoFocus inputMode="numeric" value={unit} onChange={(e) => setUnit(e.target.value.replace(/\D/g, ''))} />
    </Modal>
  );
}
