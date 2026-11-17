// Online Sale page for one term — same layout as the POS SalePage: entry panel | slip lines,
// plus the status bar. Nothing is sent to the server while typing; "✅ Save" sends the slip once and
// the server checks it then (discount, unit break, closed numbers, Max Unit, hot %, balance).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Modal, useToast } from './components/ui.jsx';
import { playSound } from './sound.js';
import { useOnline } from './onlineContext.jsx';
import { onlineApi } from './onlineApi.js';
import { useLive } from './onlineLive.js';
import { dateTime, isTermOpen, money } from './format.js';
import { PATTERN_KEYS, entryPatternHint, expandApayePauk, hasRepeatDigits, normalizeEntryInput, parseEntry, replaceGroupedCartLine } from './entryPatterns.js';
import { patternLabel } from './patterns.js';
import { nextPrintCopy, printOnlineSlip, ticketLines } from './onlinePrint.js';

// "Save & Print" preference, remembered per device like the POS Sale page's print toggle.
const PRINT_KEY = 'online_print_on_save';
const readPrintOnSave = () => { try { return localStorage.getItem(PRINT_KEY) !== '0'; } catch { return true; } };

const MODE_BUTTON = (on) => ({
  flex: 1,
  fontWeight: 700,
  color: on ? '#fff' : '#2563eb',
  background: on ? '#2563eb' : undefined,
  borderColor: on ? '#2563eb' : undefined,
});

export default function OnlineSalePage() {
  const { termId } = useParams();
  const { user, refreshMe, setUnsaved, guardedNavigate, openPrinterSettings } = useOnline();
  const toast = useToast();
  const numRef = useRef(null);
  const unitRef = useRef(null);

  const [term, setTerm] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const [typeId, setTypeId] = useState(null);
  const [rMode, setRMode] = useState(false);
  const [uMode, setUMode] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [lastNumber, setLastNumber] = useState(''); // last plain number committed, for bare "R" -> "<n>RR"
  const [entryNumber, setEntryNumber] = useState('');
  const [entryUnit, setEntryUnit] = useState('');
  const [cart, setCart] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [held, setHeld] = useState(() => readHeld(user.id, termId)); // Hold: slips parked in this browser
  const [showHeld, setShowHeld] = useState(false);
  const [editing, setEditing] = useState(null); // ✏️ clicked: the line being edited
  const [groupLine, setGroupLine] = useState(null); // 🗑 on a grouped line: confirm delete of every number in it
  const [apayeAsk, setApayeAsk] = useState(null); // 2D: 145 typed → confirm အပြီးခွေ
  const [apayeReady, setApayeReady] = useState(null);
  const [lastRowId, setLastRowId] = useState(null);

  const [saving, setSaving] = useState(false);
  const [nextSlip, setNextSlip] = useState(''); // this user's next slip number here, e.g. kth-0003
  const [saved, setSaved] = useState(null);
  const [printOnSave, setPrintOnSave] = useState(readPrintOnSave);
  const [lastSale, setLastSale] = useState(null); // { ticket, lines } for Reprint
  const [printing, setPrinting] = useState(false);

  // ---- load term + bet types ----
  useEffect(() => {
    Promise.all([onlineApi(`/terms/${termId}`), onlineApi('/meta')])
      .then(([t, m]) => { setTerm(t); setMeta(m); })
      .catch((err) => setLoadError(err.message));
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [termId]);
  // The admin changed a term (e.g. its hot numbers): the server pushes a notice and the term is
  // reloaded so the hot-number marquee stays current. Typing itself never calls the server.
  // Next slip number (the user's own sequence in this term): read when the page opens and after
  // each save — never while typing.
  const loadNextSlip = () => onlineApi(`/tickets/next-slip?term_id=${termId}`).then((r) => setNextSlip(r.slip_no)).catch(() => {});
  useEffect(() => { loadNextSlip(); }, [termId]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('terms', () => { onlineApi(`/terms/${termId}`).then(setTerm).catch(() => {}); });

  // 2D-only / 3D-only terms offer just that type.
  const betTypes = useMemo(() => {
    const all = meta?.bet_types ?? [];
    if (term?.game === '2D') return all.filter((bt) => bt.digits === 2);
    if (term?.game === '3D') return all.filter((bt) => bt.digits === 3);
    return all;
  }, [meta, term]);
  const typeById = useMemo(() => new Map(betTypes.map((bt) => [bt.id, bt])), [betTypes]);
  useEffect(() => { if (typeId == null && betTypes.length) setTypeId(betTypes[0].id); }, [betTypes, typeId]);
  const betType = typeById.get(typeId);
  const digits = betType?.digits ?? 2;

  const open = term ? isTermOpen(term, now) : false;
  const unitPrice = term?.unit_price ?? 0;

  // ---- unsaved guard (Exit / term change asks first) ----
  useEffect(() => { setUnsaved(cart.length > 0); }, [cart.length, setUnsaved]);
  useEffect(() => () => setUnsaved(false), [setUnsaved]);
  useEffect(() => {
    if (!cart.length) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [cart.length]);

  // No server request while typing: the slip is priced here (units × unit price) and only Save
  // talks to the server, which then applies discount, break, Max Unit, hot % and balance.

  const totalUnits = cart.reduce((s, l) => s + l.unit * l.numbers.length, 0);
  const grossAmount = totalUnits * unitPrice;

  function selectType(id) {
    setTypeId(id);
    setEntryNumber('');
    numRef.current?.focus();
  }

  // ✏️ Edit only edits: the line is changed in place (same row, same position) from a dialog.
  // 🗑 is the only thing that removes a line.
  // Alt+Delete: remove the most recently entered line (from anywhere on the page, but not while
  // a dialog is open).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      if (editing || groupLine || apayeAsk || showHeld || saved) return;
      e.preventDefault();
      setCart((c) => {
        if (!c.length) return c;
        const last = c[c.length - 1];
        setExpanded((x) => { const n = new Set(x); n.delete(last.rowId); return n; });
        return c.slice(0, -1);
      });
      playSound('brakLimit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, groupLine, apayeAsk, showHeld, saved]);

  // ⏸ Hold: park the slip being entered under the next number (in this browser only, never sent to
  // the server) and clear the table for the next customer. "Hold (N)" lists them to recall later.
  function holdSlip() {
    if (!cart.length) return;
    const nextNo = nextHoldNo(user.id, termId);
    const list = [...held, { no: nextNo, at: new Date().toISOString(), lines: cart }];
    setHeld(list);
    writeHeld(user.id, termId, list);
    setCart([]);
    setExpanded(new Set());
    setLastRowId(null);
    toast(`⏸ Hold #${nextNo} သိမ်းထားပါပြီ`, 'success');
    numRef.current?.focus();
  }

  function recallHeld(slip) {
    if (cart.length) return toast('လက်ရှိ slip ကို Save သို့မဟုတ် Hold အရင်လုပ်ပါ', 'error');
    const list = held.filter((h) => h.no !== slip.no);
    setHeld(list);
    writeHeld(user.id, termId, list);
    setCart(slip.lines);
    setShowHeld(false);
    toast(`Hold #${slip.no} ပြန်ခေါ်ပြီးပါပြီ`, 'success');
    numRef.current?.focus();
  }

  // Add a held slip's lines to the slip being entered (instead of replacing it), then drop it
  // from the Hold list. Lines get fresh row ids so they never clash with the current ones.
  function mergeHeld(slip) {
    const lines = slip.lines.map((l, i) => ({ ...l, rowId: `${Date.now()}-m${i}-${Math.random()}` }));
    const list = held.filter((h) => h.no !== slip.no);
    setHeld(list);
    writeHeld(user.id, termId, list);
    setCart((c) => [...c, ...lines]);
    setShowHeld(false);
    toast(`Hold #${slip.no} ကို လက်ရှိ slip ထဲ ပေါင်းထည့်ပြီးပါပြီ`, 'success');
    numRef.current?.focus();
  }

  function dropHeld(slip) {
    const list = held.filter((h) => h.no !== slip.no);
    setHeld(list);
    writeHeld(user.id, termId, list);
    if (!list.length) setShowHeld(false);
  }

  // Ungroup: the group line becomes one plain line per number (same units), in its place.
  // The table lists newest first, so the new lines are inserted in reverse to read top-down.
  function ungroupLine(line) {
    const d = typeById.get(line.bet_type_id)?.digits ?? digits;
    const stamp = Date.now();
    setCart((c) => {
      const result = replaceGroupedCartLine(c, line, d, (i) => `u-${stamp}-${i}-${Math.random().toString(36).slice(2)}`);
      return result.ok ? result.cart : c;
    });
    setExpanded((s) => { const n = new Set(s); n.delete(line.rowId); return n; });
    setLastRowId(null);
    setEditing(null);
  }

  function saveEditedLine(updated) {
    setCart((c) => c.map((x) => (x.rowId === updated.rowId ? updated : x)));
    setExpanded((s) => { const n = new Set(s); n.delete(updated.rowId); return n; });
    setLastRowId(updated.rowId);
    setEditing(null);
    playSound('digitEntry');
    numRef.current?.focus();
  }

  function fail(message, field) {
    toast(message, 'error');
    playSound('brakLimit');
    field.current?.focus();
    field.current?.select?.();
  }

  // Auto mode: once Number holds a complete entry (a full number or a finished pattern), jump to
  // Unit without waiting for Enter — same rule as the POS Sale page.
  function tryAutoFocusUnit(raw) {
    if (!autoMode || uMode) return;
    if (parseEntry(raw, digits).error) return;
    unitRef.current?.focus();
    unitRef.current?.select();
  }

  function setNumberInput(value) {
    // Bare "R" re-uses the last committed number as its RR pattern (other orders only).
    const next = !rMode && value === 'R' && lastNumber.length === digits ? `${lastNumber}RR` : value;
    setEntryNumber(next);
    tryAutoFocusUnit(next);
  }

  function pushCartLine(input, numbers) {
    const unit = Number(entryUnit);
    if (!Number.isInteger(unit) || unit < 1) return fail('ယူနစ် ထည့်ပါ', unitRef);
    const base = String(input).replace(/R+$/, '').replace(/A$/, '').replace(/-$/, '');
    if (/^\d+$/.test(base) && base.length === digits) setLastNumber(base);
    const rowId = `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setCart((c) => [...c, { rowId, bet_type_id: betType.id, input, numbers: [...numbers], unit }]);
    setLastRowId(rowId);
    playSound('digitEntry');
    setEntryNumber('');
    setApayeReady(null);
    numRef.current?.focus();
  }

  function commitLine(input) {
    const parsed = parseEntry(input, digits);
    if (parsed.error) return fail(parsed.error, numRef);
    pushCartLine(input, parsed.numbers);
  }

  function commitApaye(digitStr, withDoubles) {
    if (hasRepeatDigits(digitStr)) return fail('ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ', numRef);
    const expanded = expandApayePauk(digitStr, withDoubles);
    if (expanded.error) return fail(expanded.error, numRef);
    pushCartLine(withDoubles ? digitStr : `${digitStr}-`, expanded.numbers);
  }

  function readApaye(raw) {
    if (digits !== 2 || rMode) return null;
    const m = /^(\d{3,})(-)?$/.exec(raw);
    return m ? { digits: m[1], withDoubles: !m[2] } : null;
  }

  function afterNumberEnter() {
    const raw = entryNumber.trim().toUpperCase();
    const ap = readApaye(raw);
    if (ap) {
      if (hasRepeatDigits(ap.digits)) return fail('ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ', numRef);
      if (!ap.withDoubles) {
        setApayeReady(raw);
        if (uMode && entryUnit) addToCart();
        else { unitRef.current?.focus(); unitRef.current?.select(); }
        return;
      }
      const preview = expandApayePauk(ap.digits, true);
      if (preview.error) return fail(preview.error, numRef);
      setApayeAsk({ input: ap.digits, preview, next: 'unit' });
      return;
    }
    if (uMode && entryUnit) { addToCart(); return; }
    unitRef.current?.focus();
    unitRef.current?.select();
  }

  function addToCart() {
    if (!open) return toast('ဤအပါတ်စဥ် ပိတ်သွားပါပြီ', 'error');
    if (!betType) return;
    const raw = entryNumber.trim().toUpperCase();
    if (!raw) return fail('ဂဏန်း ထည့်ပါ', numRef);
    const input = rMode && /^\d+$/.test(raw) ? `${raw}R` : raw;
    const unit = Number(entryUnit);
    if (!Number.isInteger(unit) || unit < 1) return fail('ယူနစ် ထည့်ပါ', unitRef);
    const ap = readApaye(input);
    if (ap) {
      if (hasRepeatDigits(ap.digits)) return fail('ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ', numRef);
      if (!ap.withDoubles) { commitApaye(ap.digits, false); return; }
      if (apayeReady === ap.digits) { commitApaye(ap.digits, true); return; }
      const preview = expandApayePauk(ap.digits, true);
      if (preview.error) return fail(preview.error, numRef);
      setApayeAsk({ input: ap.digits, preview, next: 'unit' });
      return;
    }
    commitLine(input);
  }

  function togglePrintOnSave() {
    setPrintOnSave((v) => {
      try { localStorage.setItem(PRINT_KEY, v ? '0' : '1'); } catch { /* not remembered */ }
      return !v;
    });
  }

  // Prints on this computer only (POS print server or the browser's print dialog, which lists this
  // computer's printers) — no online server call. "Copy (n)" is counted in this browser.
  async function printSale(sale) {
    setPrinting(true);
    try {
      const copy = nextPrintCopy(sale.ticket.id);
      const how = await printOnlineSlip({ ticket: sale.ticket, term, user, lines: sale.lines, copy });
      if (how === 'direct') toast(`🖨️ Slip ${sale.ticket.slip_no} ပရင့်ထုတ်ပြီးပါပြီ`, 'success');
    } catch (err) {
      toast(`ပရင့်ထုတ်၍ မရပါ — ${err.message}`, 'error');
    } finally {
      setPrinting(false);
    }
  }

  async function save() {
    if (!term || !cart.length) return;
    setSaving(true);
    try {
      const ticket = await onlineApi('/tickets', { method: 'POST', body: { term_id: term.id, entries: toEntries(cart) } });
      playSound('checkOut');
      // Print what the server actually saved (numbers may have been cut or left out — see adjustments).
      const sale = { ticket, lines: ticketLines(ticket) };
      setLastSale(sale);
      setSaved(ticket);
      setCart([]);
      setExpanded(new Set());
      refreshMe().catch(() => {});
      loadNextSlip();
      if (printOnSave) printSale(sale);
    } catch (err) {
      toast(err.message, 'error');
      playSound('brakLimit');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <div className="empty-state">⚠️ {loadError}</div>;
  if (!term || !meta) return <div className="center-note">Loading...</div>;

  const canSave = open && cart.length > 0 && !saving;
  const hintLabel = rMode ? `${digits === 3 ? 'သုံးလုံး' : 'နှစ်လုံး'}ပတ်လည်` : entryPatternHint(entryNumber, digits);

  return (
    <div className="sale-page ol-sale">
      <div className="sale-page-body">
        <div className="term-banner sale-term-banner" style={{ marginBottom: 8, background: 'linear-gradient(135deg,#065f46,#059669)' }}>
          <b>အပါတ်စဉ်:</b>
          <span className="active-chip">{term.description}</span>
          {/* No unit price or time-to-close here; only whether betting has closed. */}
          {!open && <span className="active-chip" style={{ background: '#b91c1c' }}>🔴 ပိတ်သွားပါပြီ</span>}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {/* စလစ်: the slips screen, from the banner's right corner (unsaved lines ask first). */}
            <button className="btn secondary sm" style={{ marginLeft: 0 }} onClick={() => guardedNavigate('/slips')}>🧾 စလစ်</button>
            <button className="btn secondary sm" style={{ marginLeft: 0 }} onClick={() => guardedNavigate('/terms')}>အပါတ်စဉ် ပြောင်းမည်</button>
          </div>
        </div>
        <HotMarquee term={term} />

        <div className="sale-panels">
          {/* ---- Entry Panel ---- */}
          <div className="sale-panel sale-entry-panel" style={{ background: '#dcfce7' }}>
            <div className="sale-field">
              <label>User</label>
              <input className="sale-input" value={`${user.username} — ${user.name}`} readOnly tabIndex={-1} />
            </div>

            <div className="sale-field" style={{ flexDirection: 'row', gap: 8 }}>
              {betTypes.map((bt) => (
                <button key={bt.id} type="button" className="btn sm secondary" tabIndex={-1} style={MODE_BUTTON(bt.id === typeId)} onClick={() => selectType(bt.id)}>
                  {bt.code}
                </button>
              ))}
              <button
                type="button"
                className="btn sm secondary"
                tabIndex={-1}
                title="R — ဂဏန်းတိုင်းကို အပြန်အလှန် (R) အဖြစ် ထည့်မည်"
                style={MODE_BUTTON(rMode)}
                onClick={() => { setRMode((v) => !v); numRef.current?.focus(); }}
              >
                R
              </button>
              <button
                type="button"
                className="btn sm secondary"
                tabIndex={-1}
                title="U — ယူနစ် မပြောင်းဘဲ ဂဏန်းမှာ Enter နှိပ်တာနဲ့ ထည့်မည်"
                style={MODE_BUTTON(uMode)}
                onClick={() => { setUMode((v) => !v); if (!uMode) setAutoMode(false); numRef.current?.focus(); }}
              >
                U
              </button>
              <button
                type="button"
                className="btn sm secondary"
                tabIndex={-1}
                title="Auto — ဂဏန်း/ပုံစံ ပြည့်တာနဲ့ Unit သို့ ခုန်မည်"
                style={MODE_BUTTON(autoMode)}
                onClick={() => { setAutoMode((v) => !v); if (!autoMode) setUMode(false); numRef.current?.focus(); }}
              >
                Auto
              </button>
            </div>

            <div style={{ textAlign: 'center', background: '#1e3a8a', color: '#fff', fontWeight: 700, padding: '6px 0', borderRadius: 6 }}>
              {hintLabel}
            </div>

            <div className="sale-num-unit-row">
              <div className="sale-field">
                <label>ဂဏန်း (Number)</label>
                <input
                  ref={numRef}
                  className="sale-input big"
                  value={entryNumber}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={12}
                  disabled={!open}
                  title="Allowed: 0-9 R * S M P W / + T K B N -"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setNumberInput(rMode ? e.target.value.replace(/[^0-9]/g, '') : normalizeEntryInput(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      afterNumberEnter();
                      return;
                    }
                    if (rMode) return;
                    // Pattern letters by physical key, so a Myanmar keyboard/IME still types them.
                    const ch = PATTERN_KEYS[e.code];
                    if (ch && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
                      e.preventDefault();
                      const el = e.target;
                      const start = el.selectionStart ?? el.value.length;
                      const end = el.selectionEnd ?? el.value.length;
                      setNumberInput((el.value.slice(0, start) + ch + el.value.slice(end)).toUpperCase());
                      requestAnimationFrame(() => { const pos = Math.min(start + 1, el.value.length); el.setSelectionRange(pos, pos); });
                    }
                  }}
                />
              </div>
              <div className="sale-field">
                <label>ယူနစ် (Unit)</label>
                <input
                  ref={unitRef}
                  className="sale-input sale-unit-input big"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  style={{ textAlign: 'right' }}
                  value={entryUnit}
                  disabled={!open}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEntryUnit(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addToCart(); return; }
                    // R pressed in Unit turns the typed number into its R pattern (as on the POS Sale page).
                    if ((e.code === 'KeyR' || e.code === 'Slash' || e.code === 'NumpadDivide') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                      const raw = entryNumber.trim();
                      if (/^[0-9]+$/.test(raw) && raw.length === digits) { e.preventDefault(); setEntryNumber(`${raw}R`); }
                    }
                  }}
                />
              </div>
            </div>
            <div className="sale-field">
              <label>ကော် (Commission)</label>
              <input
                className="sale-input"
                readOnly
                tabIndex={-1}
                style={{ textAlign: 'right' }}
                value={saved && !cart.length ? money(saved.discount_amount) : '-'}
              />
            </div>

            <div className="sale-total-box">
              <span>{totalUnits} units</span>
              <span>{money(grossAmount)} Ks</span>
            </div>


            <button className="btn block" style={{ marginTop: 10 }} disabled={!canSave} onClick={save}>
              {saving ? 'သိမ်းနေသည်...' : `${printOnSave ? '✅ Save & Print' : '✅ Save'}${cart.length ? ` · ${money(grossAmount)} Ks` : ''}`}
            </button>
            {cart.length > 0 && (
              <button className="btn secondary block" style={{ marginTop: 8 }} onClick={holdSlip}>
                ⏸ Hold
              </button>
            )}
            {held.length > 0 && (
              <button className="btn secondary block hold-list-btn" style={{ marginTop: 8 }} onClick={() => setShowHeld(true)}>
                📂 Hold ({held.length}) — ပြန်ခေါ်ရန်
              </button>
            )}
            {lastSale && (
              <button className="btn secondary block" style={{ marginTop: 8 }} disabled={printing} onClick={() => printSale(lastSale)}>
                🖨️ Reprint Slip ({lastSale.ticket.slip_no})
              </button>
            )}
          </div>

          {/* ---- Slip lines ---- */}
          <div className="sale-panel sale-display-panel">
            <div className="slip-banner slip-banner-purple">Online - {user.username} - {nextSlip || '…'}</div>
            <div className="sale-table-scroll">
              <table className="sale-table">
                <thead>
                  <tr>
                    <th>အမျိုးအစား</th>
                    <th>ဂဏန်း</th>
                    <th>ယူနစ်</th>
                    <th>မှတ်ချက်</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cart].reverse().map((l) => {
                    const isExpanded = expanded.has(l.rowId);
                    return (
                      <React.Fragment key={l.rowId}>
                        <tr className={l.rowId === lastRowId ? 'sale-row-new' : ''}>
                          <td><span className="badge purple">{typeById.get(l.bet_type_id)?.description}</span></td>
                          <td className="sale-num">
                            {l.numbers.length > 1 && (
                              <button
                                className="sale-expand-btn"
                                title="ဂဏန်းအားလုံး ကြည့်ရန်"
                                onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(l.rowId)) n.delete(l.rowId); else n.add(l.rowId); return n; })}
                              >
                                {isExpanded ? '▾' : '▸'}
                              </button>
                            )}
                            {/* ▸ group icon + the pattern as the POS names it: 12R -> 12R, 1P -> 1အပါ */}
                            {patternLabel(l.input)}
                          </td>
                          <td>{l.unit}</td>
                          {/* မှတ်ချက်: typed pattern + units; the group icon splits the line into one number per row */}
                          <td className="sale-note">
                            {l.numbers.length > 1 && (
                              <button className="sale-group-btn" title="ဂဏန်းတစ်ကွက်ချင်း ခွဲရန်" aria-label="ခွဲ" onClick={() => ungroupLine(l)}><LinkIcon /></button>
                            )}
                            {l.input} {l.unit}
                          </td>
                          <td className="sale-actions">
                            <button className="sale-edit" title="ပြင်မည်" aria-label="ပြင်မည်" onClick={() => setEditing(l)}>✏️</button>
                            <button
                              className="sale-rm"
                              title="ဖျက်မည်"
                              aria-label="ဖျက်မည်"
                              onClick={() => {
                                if ((l.numbers?.length ?? 1) > 1) setGroupLine(l);
                                else setCart((c) => c.filter((x) => x.rowId !== l.rowId));
                              }}
                            >
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="sale-expand-row">
                            <td colSpan={5}>
                              <div className="sale-expand-numbers">
                                {l.numbers.map((num) => <span key={num} className="sale-num-chip">{num}</span>)}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {!cart.length && (
                    <tr><td colSpan={5} className="empty-state" style={{ padding: 30 }}>ဂဏန်း မထည့်ရသေးပါ</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="sale-status-bar sale-status-bar-compact ol-status">
          <div className="sale-status-left">
            <span>👤 {user.username}</span>
            <span className="status-sep" />
            <button
              type="button"
              className={`status-icon-btn ${printOnSave ? 'active' : ''}`}
              title={`🖨️ Save & Print — ${printOnSave ? 'ON' : 'OFF'}`}
              aria-pressed={printOnSave}
              onClick={togglePrintOnSave}
            >
              🖨️
            </button>
            <button type="button" className="status-icon-btn" title="⚙️ Slip Printer Settings" onClick={openPrinterSettings}>⚙️</button>
            <span className="status-sep" />
            <span>💰 <span className={user.balance < 0 ? 'ol-neg' : ''}>{money(user.balance)}</span>{user.unlimited ? ' ∞' : ''}</span>
            <span className="status-sep" />
          </div>
          <span className="sale-status-center">
            All Total: {money(grossAmount)}
          </span>
          <span className="sale-status-right">
            {now.toLocaleDateString('en-GB')} {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
          </span>
        </div>
      </div>

      {showHeld && (
        <Modal title="⏸ Hold slip များ" onClose={() => setShowHeld(false)} footer={<button className="btn secondary" onClick={() => setShowHeld(false)}>ပိတ်မည်</button>}>
          {cart.length > 0 && (
            <div className="ol-muted" style={{ marginBottom: 10 }}>
              လက်ရှိ slip ရိုက်နေဆဲဖြစ်၍ "ပေါင်းထည့်မည်" ဖြင့် Hold slip ကို လက်ရှိ slip ထဲ ပေါင်းထည့်နိုင်ပါသည်
            </div>
          )}
          <div className="held-list">
            {held.map((h) => {
              const units = h.lines.reduce((sum, l) => sum + l.unit * l.numbers.length, 0);
              return (
                <div key={h.no} className="held-row">
                  <div className="held-info">
                    <b>Hold #{h.no}</b>
                    <span className="ol-muted"> · {dateTime(h.at)} · {h.lines.length} ကြောင်း · {units} units · {money(units * unitPrice)} Ks</span>
                  </div>
                  {cart.length > 0
                    ? <button className="btn sm" onClick={() => mergeHeld(h)}>➕ ပေါင်းထည့်မည်</button>
                    : <button className="btn sm" onClick={() => recallHeld(h)}>ပြန်ခေါ်မည်</button>}
                  <button className="sale-rm" title="Hold ဖျက်မည်" aria-label="Hold ဖျက်မည်" onClick={() => dropHeld(h)}><TrashIcon /></button>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {apayeAsk && (
        <Modal
          title="အပြီးခွေ"
          onClose={() => {
            setApayeAsk(null);
            requestAnimationFrame(() => { numRef.current?.focus(); numRef.current?.select(); });
          }}
          onConfirm={() => {
            setApayeReady(apayeAsk.input);
            setApayeAsk(null);
            requestAnimationFrame(() => { unitRef.current?.focus(); unitRef.current?.select(); });
          }}
          footer={(
            <>
              <button className="btn secondary" onClick={() => {
                setApayeAsk(null);
                requestAnimationFrame(() => { numRef.current?.focus(); numRef.current?.select(); });
              }}>No</button>
              <button
                className="btn"
                autoFocus
                onClick={() => {
                  setApayeReady(apayeAsk.input);
                  setApayeAsk(null);
                  requestAnimationFrame(() => { unitRef.current?.focus(); unitRef.current?.select(); });
                }}
              >
                Yes
              </button>
            </>
          )}
        >
          <p>{apayeAsk.input} ကို အပြီးခွေ ရိုက်မှာလား?</p>
          <p style={{ fontWeight: 800 }}>{apayeAsk.preview.codes.join(', ')}</p>
          <p className="ol-muted">{apayeAsk.preview.numbers.length} ကွက်</p>
        </Modal>
      )}

      {editing && (
        <EditLineModal
          line={editing}
          betType={typeById.get(editing.bet_type_id)}
          onSave={saveEditedLine}
          onUngroup={ungroupLine}
          onClose={() => { setEditing(null); numRef.current?.focus(); }}
        />
      )}

      {groupLine && (
        <Modal
          title="Group ဖျက်မှာလား?"
          onClose={() => setGroupLine(null)}
          footer={(
            <>
              <button className="btn secondary" onClick={() => setGroupLine(null)}>မလုပ်တော့ပါ</button>
              <button
                className="btn danger"
                onClick={() => { setCart((c) => c.filter((x) => x.rowId !== groupLine.rowId)); setGroupLine(null); numRef.current?.focus(); }}
              >
                ဖျက်မည်
              </button>
            </>
          )}
        >
          <div>
            <b>{groupLine.input} {groupLine.unit}</b>
            <span className="ol-muted"> · {typeById.get(groupLine.bet_type_id)?.description} · ဂဏန်း {groupLine.numbers.length} လုံး တစ်ခါတည်း ပျက်ပါမည်။ ခွဲချင်ရင် မှတ်ချက်က 🔗 ကို နှိပ်ပါ။</span>
          </div>
        </Modal>
      )}

      {saved && (
        <SavedModal
          ticket={saved}
          term={term}
          typeById={typeById}
          onClose={() => { setSaved(null); numRef.current?.focus(); }}
          onPrint={lastSale?.ticket.id === saved.id ? () => printSale(lastSale) : undefined}
          printing={printing}
        />
      )}
    </div>
  );
}

// ✏️ Edit one slip line: its number/pattern and units. Checked with the same rules as adding a
// line; saving replaces the line in place.
function EditLineModal({ line, betType, onSave, onUngroup, onClose }) {
  // A plain number: the number and its units can change. A group (12R, 1P, …): only its units —
  // or "Ungroup" splits it into one plain line per number.
  const digits = betType?.digits ?? 2;
  const isGroup = line.numbers.length > 1;
  const [number, setNumber] = useState(line.input);
  const [unit, setUnit] = useState(String(line.unit));
  const [error, setError] = useState('');
  const save = () => {
    const units = Number(unit);
    if (!Number.isInteger(units) || units < 1) return setError('ယူနစ် ထည့်ပါ');
    if (isGroup) return onSave({ ...line, unit: units });
    const input = number.trim();
    if (!new RegExp(`^[0-9]{${digits}}$`).test(input)) return setError(`ဂဏန်း ${digits} လုံး ထည့်ပါ`);
    onSave({ ...line, input, numbers: [input], unit: units });
  };
  return (
    <Modal
      title="ပြင်မည်"
      onClose={onClose}
      onConfirm={save}
      footer={(
        <>
          {isGroup && <button className="btn secondary" style={{ marginRight: 'auto' }} onClick={() => onUngroup(line)}>Ungroup</button>}
          <button className="btn secondary" onClick={onClose}>မလုပ်တော့ပါ</button>
          <button className="btn" onClick={save}>သိမ်းမည်</button>
        </>
      )}
    >
      {error && <div className="login-error">{error}</div>}
      <div className="ol-muted" style={{ marginBottom: 10 }}>
        {betType?.description}{isGroup ? ` · Group · ဂဏန်း ${line.numbers.length} လုံး — ယူနစ်သာ ပြင်နိုင်သည်` : ''}
      </div>
      <div className="form-group">
        <label className="field-label" htmlFor="edit-number">ဂဏန်း</label>
        <input
          id="edit-number"
          className="input"
          autoFocus={!isGroup}
          readOnly={isGroup}
          disabled={isGroup}
          inputMode="numeric"
          maxLength={isGroup ? undefined : digits}
          value={isGroup ? patternLabel(line.input) : number}
          onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </div>
      <div className="form-group">
        <label className="field-label" htmlFor="edit-unit">ယူနစ်</label>
        <input id="edit-unit" className="input" autoFocus={isGroup} inputMode="numeric" value={unit} onChange={(e) => setUnit(e.target.value.replace(/[^0-9]/g, ''))} />
      </div>
    </Modal>
  );
}

// This term's hot numbers scrolling under the header: "🔥 ဟော့ဂဏန်းများ: 12, 45, 78".
// The 🔥 button fixed at the bar's right end opens the hot numbers in a dialog.
export function HotMarquee({ term }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const hot = term.hot ?? [];
  if (!hot.length) return null;
  const numbers = [...new Set(hot.map((h) => h.number))].sort();
  const text = numbers.join(', '); // each number once, comma-separated (the label stays fixed)
  return (
    <>
      <div className="hot-marquee">
        <span className="hot-marquee-label">🔥 ဟော့ဂဏန်းများ:</span>
        <div className="hot-marquee-view" role="marquee" aria-label={text}>
          <div className="hot-marquee-track" style={{ animationDuration: `${Math.max(12, text.length * 0.18)}s` }}>
            <span>{text}</span>
          </div>
        </div>
        <button type="button" className="hot-marquee-btn" title="ဟော့ဂဏန်းများ ကြည့်ရန်" aria-label="ဟော့ဂဏန်းများ ကြည့်ရန်" onClick={() => setOpen(true)}>🔥</button>
      </div>
      {open && (
        <Modal
          title="🔥 ဟော့ဂဏန်းများ"
          onClose={() => setOpen(false)}
          footer={(
            <>
              <button className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button
                className="btn"
                autoFocus
                onClick={async () => {
                  // One number per line, as listed.
                  if (await copyText(numbers.join('\n'))) {
                    toast(`ဟော့ဂဏန်း ${numbers.length} လုံး copy ကူးပြီးပါပြီ`, 'success');
                    setOpen(false);
                  } else {
                    toast('Copy ကူး၍ မရပါ', 'error');
                  }
                }}
              >
                📋 Copy
              </button>
            </>
          )}
        >
          {/* Shown like a plain text box: one number per line */}
          <textarea
            className="input hot-textbox"
            readOnly
            rows={Math.min(12, Math.max(3, numbers.length))}
            value={numbers.join(String.fromCharCode(10))}
          />
        </Modal>
      )}
    </>
  );
}

// Copies text to the clipboard; falls back to execCommand where the Clipboard API is missing
// (e.g. the site opened over plain http on the LAN). Resolves to whether it worked.
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* try the fallback */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

// Held slips (⏸ Hold) live in this browser's localStorage, per user and term — never on the server.
const heldKey = (userId, termId) => `online_hold_${userId}_${termId}`;
function readHeld(userId, termId) {
  try { return JSON.parse(localStorage.getItem(heldKey(userId, termId)) || '[]'); } catch { return []; }
}
// Hold numbers keep counting up for the term (#1, #2, #3 …) even after slips are recalled.
function nextHoldNo(userId, termId) {
  const key = `${heldKey(userId, termId)}_no`;
  let no = Math.max(0, ...readHeld(userId, termId).map((h) => h.no));
  try { no = Math.max(no, Number(localStorage.getItem(key)) || 0); } catch { /* ignore */ }
  try { localStorage.setItem(key, String(no + 1)); } catch { /* ignore */ }
  return no + 1;
}
function writeHeld(userId, termId, list) {
  try {
    if (list.length) localStorage.setItem(heldKey(userId, termId), JSON.stringify(list));
    else localStorage.removeItem(heldKey(userId, termId));
  } catch { /* kept for this page only */ }
}

// Solid red trash can for the delete action (SVG, so it is clearly red on every device).
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="#dc2626" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2z" />
      <path d="M6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9zm4 2v8h1.6v-8H10zm2.4 0v8H14v-8h-1.6z" fillRule="evenodd" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="link-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// Sends each line's own expansion so POS patterns (1P, SS, 12*, ...) need no server-side parser.
const toEntries = (cart) => cart.map((l) => ({ bet_type_id: l.bet_type_id, input: l.input, numbers: l.numbers, units: l.unit }));

// One line per number the server cut down or left out when saving: "00 - မရ" when nothing was
// taken, "11 - 950 မရ" for the units that were not taken.
function adjustmentText(a) {
  return a.saved > 0 ? `${a.requested - a.saved} မရ` : 'မရ';
}

function SavedModal({ ticket, term, typeById, onClose, onPrint, printing }) {
  return (
    <Modal
      title="✅ သိမ်းပြီးပါပြီ"
      onClose={onClose}
      onConfirm={onClose}
      footer={(
        <>
          {onPrint && <button className="btn secondary" disabled={printing} onClick={onPrint}>🖨️ Print</button>}
          <button className="btn" onClick={onClose}>🧾 ဆက်ရောင်းမည်</button>
        </>
      )}
    >
      <div className="ol-slip-head">
        <div>စလစ် <b>{ticket.slip_no}</b></div>
        <div className="ol-muted">{term.description} · {dateTime(ticket.created_at)}</div>
      </div>
      {ticket.adjustments?.length > 0 && (
        <div className="ol-adjust">
          <div className="ol-adjust-title">မရဂဏန်းများ</div>
          {ticket.adjustments.map((a) => (
            <div key={`${a.bet_type_id}:${a.number}`} className="ol-adjust-row"><b>{a.number}</b> - {adjustmentText(a)}</div>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="ol-table">
          <thead><tr><th>အမျိုးအစား</th><th>ဂဏန်း</th><th className="num">ယူနစ်</th><th className="num">ပမာဏ</th></tr></thead>
          <tbody>
            {ticket.items.map((i) => (
              <tr key={i.id}>
                <td>{typeById.get(i.bet_type_id)?.description ?? i.bet_type}</td>
                <td><b>{i.number}</b></td>
                <td className="num">{i.units}</td>
                <td className="num">{money(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ol-totals">
        <div className="ol-total ol-total-main"><span>Total</span><b>{money(ticket.gross_amount)} ကျပ်</b></div>
      </div>
    </Modal>
  );
}
