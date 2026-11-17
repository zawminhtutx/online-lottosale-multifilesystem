// The phone keypad — a port of online-mobile's pattern_keypad_sheet.dart, so the web mini app types
// numbers the same way as the user app: big on-screen keys, no phone keyboard. Tapping the ဂဏန်း or
// ယူနစ် box picks which one the digits go into; a finished number / pattern jumps to ယူနစ် by itself.
//
//  အမြန်   — the letter patterns (SM, MM, W, K, T, …), အပါ, and ကူး (paste from Viber / Telegram)
//  စီးရီး  — appends *          ဘရိတ် (2D) — appends B (5B)      ကူး (3D) — paste
//  ဖြတ်    — clears the field   အခွေ — "123" + unit -> 12R, 13R, 23R (+ doubles)
//  ပြည့်ဂဏန်း — adds what is typed (with nothing typed: the numbers already at the break);
//             hold it 3 seconds to add and save the slip
//  R       — reverse; alone it means the reverses of the last plain number
//  L / R / U — sweep 00, 01, 02 … / always R / keep the unit and add as soon as the number is full
import React, { useRef, useState } from 'react';
import { Modal } from '../components/ui.jsx';
import { playSound } from '../sound.js';
import { expandApayePauk, hasRepeatDigits, parseEntry, uniquePermutations } from '../entryPatterns.js';
import { patternLabel } from '../patterns.js';
import { parsePastedBets } from './pastedBets.js';

const ok = (raw, digits) => !parseEntry(raw, digits).error;
// Long input ("12/34/56/78") shrinks instead of wrapping.
const fit = (v) => (v.length > 13 ? 'longer' : v.length > 8 ? 'long' : '');

export default function PatternKeypad({ digits, onAdd, onSave, onShowFull, onHide, docked, onToggleDock, disabled }) {
  const is3d = digits === 3;
  const [s, setS] = useState({ field: 'number', number: '', unit: '1', error: null });
  const [modes, setModes] = useState({ L: false, R: false, U: false });
  const lastPlain = useRef(null); // for a lone R: the reverses of the last plain number
  const [quickOpen, setQuickOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const setError = (error) => setS((x) => ({ ...x, error }));
  const applyR = (raw) => (modes.R && /^\d+$/.test(raw) ? `${raw}R` : raw);
  const remember = (key) => { if (key.length === digits && /^\d+$/.test(key)) lastPlain.current = key; };
  const reversesOfLast = () => {
    const base = lastPlain.current;
    return base ? uniquePermutations(base).filter((n) => n !== base).sort() : [];
  };
  const sweepNext = (number) => String(((Number(number) || 0) + 1) % 10 ** digits).padStart(digits, '0');

  // Adds parsed entries through the page (which merges a repeated key into its line).
  function commit(keys, unit) {
    const entries = [];
    for (const key of keys) {
      const parsed = parseEntry(key, digits);
      if (parsed.error) { setError(parsed.error); playSound('brakLimit'); return false; }
      entries.push({ key, numbers: parsed.numbers, grouptype: parsed.grouptype, unit });
    }
    return onAdd(entries);
  }

  // Number just became a complete entry: jump to Unit — or with U on, add it at once.
  function completed(next, { wasNumberField }) {
    const u = Number(next.unit);
    if (modes.U && u > 0) {
      const key = applyR(next.number);
      if (commit([key], u)) {
        remember(key);
        playSound('digitEntry');
        return { ...next, number: '', field: 'number', error: null };
      }
      return next;
    }
    return { ...next, field: 'unit', unit: wasNumberField ? '' : next.unit };
  }

  function typeInField(transform) {
    if (disabled) return;
    if (s.field === 'number') {
      const next = { ...s, number: transform(s.number), error: null };
      setS(ok(next.number, digits) ? completed(next, { wasNumberField: true }) : next);
    } else {
      setS({ ...s, unit: transform(s.unit).slice(0, 9), error: null });
    }
  }

  const tapDigit = (d) => typeInField((cur) => cur + d);
  const appendB = () => typeInField((cur) => `${cur}B`);
  const appendStar = () => typeInField((cur) => `${cur}*`);
  const clearField = () => typeInField(() => '');

  // R works on the Number even while Unit is picked.
  function appendR() {
    if (disabled) return;
    if (!s.number) {
      if (!lastPlain.current) return setError('ဂဏန်း အရင်ရိုက်ပြီးမှ R နှိပ်ပါ (ဥပမာ - 25 ပြီးမှ R)');
      if (!reversesOfLast().length) return setError(`${lastPlain.current} ၏ အပြန်ဂဏန်း မရှိပါ`);
      if (modes.U && Number(s.unit) > 0) return add({ ...s, number: 'R' });
      return setS({ ...s, number: 'R', field: 'unit', unit: '', error: null });
    }
    const wasNumberField = s.field === 'number';
    const next = { ...s, number: `${s.number}R`, error: null };
    setS(ok(next.number, digits) ? completed(next, { wasNumberField }) : next);
  }

  function appendP() {
    if (!/^\d$/.test(s.number)) return setError('ဂဏန်း တစ်လုံး အရင်ရိုက်ပါ (ဥပမာ - 3 ပြီးမှ အပါ)');
    const next = { ...s, number: `${s.number}P`, error: null };
    setS(ok(next.number, digits) ? completed(next, { wasNumberField: true }) : next);
  }

  function selectPattern(code) {
    setS(completed({ ...s, number: code, error: null }, { wasNumberField: true }));
  }

  // ENTER: add Number at Unit. "12/34" adds both; a lone R adds the last number's reverses.
  function add(cur = s) {
    if (disabled) return false;
    if (modes.L && !cur.unit.trim()) {
      setS({ ...cur, number: sweepNext(cur.number), unit: '', field: 'unit', error: null });
      return true;
    }
    const u = Number(cur.unit) || 0;
    if (!cur.number || u <= 0) { setError('ဂဏန်းနှင့် ယူနစ် ဖြည့်ပါ'); return false; }
    const lone = cur.number.split('/').some((p) => p.trim() === 'R');
    const parts = cur.number.split('/').map((p) => p.trim()).filter(Boolean)
      .flatMap((p) => (p === 'R' ? reversesOfLast() : [applyR(p)]));
    if (!parts.length) { setError('ဂဏန်းနှင့် ယူနစ် ဖြည့်ပါ'); return false; }
    if (!commit(parts, u)) return false;
    if (!lone) parts.forEach(remember);
    playSound('digitEntry');
    setS(modes.L
      ? { ...cur, number: sweepNext(cur.number), unit: '', field: 'unit', error: null }
      : { ...cur, number: '', field: 'number', error: null });
    return true;
  }

  function enter() {
    // "25 → ENTER → unit → ENTER": ENTER with Unit still empty just waits for the unit.
    if (!modes.L && s.number && s.field === 'unit' && !s.unit.trim()) return setError(null);
    add();
  }

  function addAsPlain() {
    if (!s.number.trim()) return onShowFull();
    add();
  }

  function addThenSave() {
    if (s.number && !add()) return;
    onSave();
  }

  function toggleMode(m) {
    setModes((x) => {
      const on = !x[m];
      if (m === 'L') return { L: on, R: on ? false : x.R, U: on ? false : x.U };
      return { ...x, [m]: on, L: on ? false : x.L };
    });
    if (m === 'L' && !modes.L) setS({ ...s, number: ''.padStart(digits, '0'), unit: '', field: 'unit', error: null });
    else setS({ ...s, field: 'number', error: null });
  }

  const quickCodes = ['PASTE', ...(is3d ? ['T'] : ['APA', 'SM', 'MM', 'MS', 'SS', 'SP', 'MP', 'P', 'N', 'W', 'K'])];

  return (
    <div className="m-keypad">
      <div className="m-kp-top">
        <button type="button" className={`m-kp-pin ${docked ? 'on' : ''}`} title={docked ? 'Undock' : 'Dock'} onClick={onToggleDock}>📌</button>
        <div className="m-kp-modes">
          <ModeKey label="L" on={modes.L} title="ဂဏန်း 00, 01, 02 … အလိုလို" onClick={() => toggleMode('L')} />
          <ModeKey label="R" on={modes.R} title="ရိုက်တာတိုင်း R အဖြစ်" onClick={() => toggleMode('R')} />
          <ModeKey label="U" on={modes.U} title="ယူနစ် သေထား — ဂဏန်းပြည့်တာနဲ့ ထည့်" onClick={() => toggleMode('U')} />
        </div>
      </div>
      {s.error && <div className="m-kp-error">{s.error}</div>}
      <div className="m-kp-fields">
        <button type="button" className={`m-kp-field ${s.field === 'number' ? 'on' : ''}`} onClick={() => setS({ ...s, field: 'number' })}>
          <small>ဂဏန်း</small>
          <span className={fit(s.number)}>{s.number || '-'}</span>
        </button>
        <button type="button" className={`m-kp-field right ${s.field === 'unit' ? 'on' : ''}`} onClick={() => setS({ ...s, field: 'unit' })}>
          <small>ယူနစ်</small>
          <span className={fit(s.unit)}>{s.unit || '-'}</span>
        </button>
      </div>

      <div className="m-kp-row">
        <Key className="ink" onClick={() => setQuickOpen(true)}>အမြန်</Key>
        <Key className="indigo" onClick={appendStar}>စီးရီး</Key>
        {is3d ? <Key className="indigo" onClick={() => setPasteOpen(true)}>ကူး</Key> : <Key className="indigo" onClick={appendB}>ဘရိတ်</Key>}
        <Key className="violet" onClick={clearField}>ဖြတ်</Key>
      </div>
      <div className="m-kp-row">
        <Key className="violet big" onClick={() => setWheelOpen(true)}>အခွေ</Key>
        <Key className="teal big" onClick={addAsPlain} onLongPress={addThenSave}>ပြည့်ဂဏန်း</Key>
      </div>
      <div className="m-kp-grid">
        {['7', '8', '9'].map((d) => <Key key={d} className="digit" onClick={() => tapDigit(d)}>{d}</Key>)}
        <Key className="lavender digit" onClick={appendR}>R</Key>
        {['4', '5', '6'].map((d) => <Key key={d} className="digit" onClick={() => tapDigit(d)}>{d}</Key>)}
        <Key className="ink enter" onClick={enter}>ENTER</Key>
        {['1', '2', '3', '0', '00', '000'].map((d) => <Key key={d} className="digit" onClick={() => tapDigit(d)}>{d}</Key>)}
      </div>
      <div className="m-kp-row">
        <Key className="indigo" onClick={onHide} title="Keypad ပိတ်ရန်">⌨️</Key>
        <Key className="teal" onClick={() => (s.number ? addThenSave() : onSave())}>💾 Save</Key>
      </div>

      {quickOpen && (
        <Modal title="အမြန်" onClose={() => setQuickOpen(false)}>
          <div className="m-quick-list">
            {quickCodes.map((c) => (
              <button
                key={c}
                type="button"
                className="m-quick-item"
                onClick={() => {
                  setQuickOpen(false);
                  if (c === 'PASTE') setPasteOpen(true);
                  else if (c === 'APA') appendP();
                  else selectPattern(c);
                }}
              >
                {c === 'PASTE' ? 'ကူး (Viber / Telegram မှ Copy ကူးထားတာ ထည့်ရန်)' : c === 'APA' ? 'အပါ (P)' : `${patternLabel(c)} (${c})`}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {wheelOpen && (
        <WheelDialog
          digits={digits}
          unit={s.unit}
          onClose={() => setWheelOpen(false)}
          onAdd={(keys, u) => { if (commit(keys, u)) { playSound('digitEntry'); setWheelOpen(false); } }}
        />
      )}
      {pasteOpen && (
        <PasteDialog
          digits={digits}
          onClose={() => setPasteOpen(false)}
          onAdd={(bets) => {
            const entries = bets.map((b) => { const p = parseEntry(b.key, digits); return { key: b.key, numbers: p.numbers, grouptype: p.grouptype, unit: b.unit }; });
            if (onAdd(entries)) {
              bets.forEach((b) => remember(b.key));
              playSound('digitEntry');
              setPasteOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}

// A keypad key; with onLongPress, holding it 3 seconds runs that instead of the tap.
function Key({ className = '', onClick, onLongPress, title, children }) {
  const timer = useRef(null);
  const fired = useRef(false);
  const start = () => {
    if (!onLongPress) return;
    fired.current = false;
    timer.current = setTimeout(() => { fired.current = true; playSound('checkOut'); onLongPress(); }, 3000);
  };
  const stop = () => clearTimeout(timer.current);
  return (
    <button
      type="button"
      className={`m-key ${className}`}
      title={title}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => onLongPress && e.preventDefault()}
      onClick={() => { if (fired.current) { fired.current = false; return; } onClick?.(); }}
    >
      {children}
    </button>
  );
}

function ModeKey({ label, on, title, onClick }) {
  return <button type="button" className={`m-mode ${on ? 'on' : ''}`} title={title} onClick={onClick}>{label}</button>;
}

// အခွေ: digits + unit -> every <digits>-long combination as an R pattern (in typed order), plus
// each digit's double / triple when အပူး is ticked. "123" (2D, အပူး) -> 11, 22, 33, 12R, 13R, 23R.
function WheelDialog({ digits, unit: startUnit, onClose, onAdd }) {
  const [number, setNumber] = useState('');
  const [unit, setUnit] = useState(startUnit);
  const [doubles, setDoubles] = useState(true);
  const [error, setError] = useState('');
  const confirm = () => {
    const u = Number(unit) || 0;
    if (u <= 0) return setError('ငွေ ထည့်ပါ');
    const chars = number.split('');
    if (chars.length < digits) return setError(`ဂဏန်း ${digits} လုံး အနည်းဆုံး ထည့်ပါ`);
    if (hasRepeatDigits(number)) return setError('ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ');
    if (digits === 2) {
      const expanded = expandApayePauk(number, doubles);
      if (expanded.error) return setError(expanded.error);
      onAdd([doubles ? `${number}A` : `${number}-`], u);
      return;
    }
    const codes = [];
    if (doubles) for (const c of new Set(chars)) codes.push(c.repeat(digits));
    const combine = (start, chosen) => {
      if (chosen.length === digits) { codes.push(`${chosen.map((i) => chars[i]).join('')}R`); return; }
      for (let i = start; i < chars.length; i++) combine(i + 1, [...chosen, i]);
    };
    combine(0, []);
    onAdd([...new Set(codes)], u);
  };
  return (
    <Modal
      title="အခွေ"
      onClose={onClose}
      onConfirm={confirm}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" onClick={confirm}>OK</button></>}
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="field-label">ဂဏန်းများ</label>
        <input className="input" autoFocus inputMode="numeric" placeholder="ဥပမာ - 123" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="form-group">
        <label className="field-label">ငွေ (ယူနစ်)</label>
        <input className="input" inputMode="numeric" value={unit} onChange={(e) => setUnit(e.target.value.replace(/\D/g, ''))} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <input type="checkbox" checked={doubles} onChange={(e) => setDoubles(e.target.checked)} /> {doubles ? 'အပူး' : 'အပူးမပါ'}
      </label>
    </Modal>
  );
}

// ကူး: a text box (filled from the clipboard when allowed) -> စစ်ဆေးမည် shows what was read; wrong
// lines in red. ထည့်မည် adds them all.
function PasteDialog({ digits, onClose, onAdd }) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(null);
  const paste = async () => {
    try { setText((await navigator.clipboard.readText()).trim()); } catch { /* the user pastes by hand */ }
  };
  React.useEffect(() => { paste(); }, []);

  if (checked) {
    const good = checked.bets.length > 0 && !checked.skipped.length;
    return (
      <Modal
        title={good ? `✓ စစ်ပြီး — ${checked.bets.length} ကွက်` : 'စစ်ဆေးချက်'}
        onClose={() => setChecked(null)}
        footer={<><button className="btn secondary" onClick={() => setChecked(null)}>ပြင်မည်</button><button className="btn" disabled={!good} onClick={() => onAdd(checked.bets)}>ထည့်မည်</button></>}
      >
        {!checked.bets.length && !checked.skipped.length && <div className="login-error">ဂဏန်း မရှိပါ</div>}
        {checked.skipped.length > 0 && (
          <div style={{ color: '#dc2626', fontWeight: 700, marginBottom: 10 }}>
            မှားနေသော စာကြောင်း {checked.skipped.length} ကြောင်း — ပြင်ပြီး ပြန်စစ်ပါ
            {checked.skipped.map((l, i) => <div key={i} style={{ fontWeight: 400 }}>✗ {l}</div>)}
          </div>
        )}
        {checked.bets.length > 0 && (
          <table className="ol-table">
            <thead><tr><th>စဥ်</th><th>ဂဏန်း</th><th className="num">ယူနစ်</th></tr></thead>
            <tbody>
              {checked.bets.map((b, i) => <tr key={i}><td>{i + 1}</td><td><b>{patternLabel(b.key)}</b></td><td className="num">{b.unit}</td></tr>)}
            </tbody>
          </table>
        )}
      </Modal>
    );
  }
  return (
    <Modal
      title="ကူး"
      onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" onClick={() => setChecked(parsePastedBets(text, digits))}>စစ်ဆေးမည်</button></>}
    >
      <textarea
        className="input"
        rows={9}
        style={{ width: '100%', fontSize: 16, fontWeight: 600 }}
        placeholder={digits === 3 ? '125 1000 / 125R 500 ...' : '25 1000 / R 3100 / 3အပါ 1500 ...'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" className="btn secondary sm" onClick={paste}>📋 Paste</button>
        <button type="button" className="btn secondary sm" onClick={() => setText('')}>ဖျက်</button>
      </div>
    </Modal>
  );
}
