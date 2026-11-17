// Upline Sale page (admin / master / agent): same entry actions as online-web, for a chosen customer.
import { api, cached, session } from '/common/js/api.js';
import { t } from '/common/js/i18n.js';
import { onLive } from '/common/js/live.js';
import { confirmDialog, dateTime, h, money, mount, openModal, parseDate, toast } from '/common/js/ui.js';
import { playSound } from '/common/js/sound.js';
import { PATTERN_KEYS, entryPatternHint, expandApayePauk, hasRepeatDigits, normalizeEntryInput, parseEntry, replaceGroupedCartLine } from '/common/js/pos-patterns/entry-patterns.js';
import { patternLabel } from '/common/js/pos-patterns/patterns.js';

function isTermOpen(term, now = new Date()) {
  if (!term || term.status !== 'open') return false;
  const openAt = parseDate(term.open_at);
  const closeAt = parseDate(term.close_at);
  if (openAt && now < openAt) return false;
  if (closeAt && now >= closeAt) return false;
  return true;
}

const toEntries = (cart) => cart.map((l) => ({ bet_type_id: l.bet_type_id, input: l.input, numbers: l.numbers, units: l.unit }));
const adjustmentText = (a) => (a.saved > 0 ? `${a.requested - a.saved} မရ` : 'မရ');
const heldKey = (actorId, userId, termId) => `admin_hold_${actorId}_${userId}_${termId}`;
function readHeld(actorId, userId, termId) {
  try { return JSON.parse(localStorage.getItem(heldKey(actorId, userId, termId)) || '[]'); } catch { return []; }
}
function nextHoldNo(actorId, userId, termId) {
  const key = `${heldKey(actorId, userId, termId)}_no`;
  let no = Math.max(0, ...readHeld(actorId, userId, termId).map((x) => x.no));
  try { no = Math.max(no, Number(localStorage.getItem(key)) || 0); } catch { /* ignore */ }
  try { localStorage.setItem(key, String(no + 1)); } catch { /* ignore */ }
  return no + 1;
}
function writeHeld(actorId, userId, termId, list) {
  try {
    if (list.length) localStorage.setItem(heldKey(actorId, userId, termId), JSON.stringify(list));
    else localStorage.removeItem(heldKey(actorId, userId, termId));
  } catch { /* this page only */ }
}

async function copyText(text) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fallback */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch { return false; }
}

export default async function sale(main, { params }) {
  main.classList.add('main-sale');
  const actor = session.get()?.user;
  const me = await api.get('/auth/me').catch(() => actor);
  if (me) session.set({ ...session.get(), user: me });
  const book = me?.role === 'admin' || me?.role === 'master';
  const canOver = book || Number(me?.sale_over) === 1;

  const [customers, openTerms, meta] = await Promise.all([
    api.get('/users?role=user'),
    api.get('/terms?status=open'),
    cached('/meta'),
  ]);
  const activeCustomers = customers.filter((u) => u.status === 'active');
  const initialTermId = params[0] ? Number(params[0]) : openTerms[0]?.id;

  if (!activeCustomers.length) {
    mount(main, h('div', { class: 'notice notice-warn' }, t('No customers to sell for')));
    return;
  }
  if (!openTerms.length && !initialTermId) {
    mount(main, h('div', { class: 'notice notice-warn' }, t('No open terms')));
    return;
  }

  const st = {
    customers: activeCustomers,
    customerId: activeCustomers[0].id,
    terms: openTerms,
    term: null,
    typeId: null,
    rMode: false,
    uMode: false,
    autoMode: false,
    lastNumber: '',
    entryNumber: '',
    entryUnit: '',
    cart: [],
    expanded: new Set(),
    held: [],
    lastRowId: null,
    apayeReady: null,
    saving: false,
    nextSlip: '',
    saveOver: false,
    now: new Date(),
    ledgerUnits: new Map(),
    ledgerSort: 'num',
    ledgerFocus: null,
    purchased: new Map(),
    comboIndex: -1,
  };

  const numRef = { current: null };
  const unitRef = { current: null };
  const cartBox = h('div', { class: 'sale-cart-box' });
  const totalBox = h('div', { class: 'sale-total-box' });
  const saveBtn = h('button', { class: 'btn btn-primary', style: 'margin-top:10px;width:100%' });
  const holdBtn = h('button', { class: 'btn', style: 'margin-top:8px;width:100%' });
  const heldBtn = h('button', { class: 'btn', style: 'margin-top:8px;width:100%' });
  const hintBox = h('div', { class: 'sale-hint' });
  const bannerExtra = h('span', {});
  const slipBanner = h('div', { class: 'slip-banner slip-banner-purple' });
  const hotHost = h('div', {});
  const statusBar = h('div', { class: 'sale-status-bar' });
  const overBox = h('label', { class: 'sale-over-check' });
  const ledgerList = h('div', { class: 'sale-ledger-list' });
  const ledgerCols = h('div', { class: 'sale-ledger-cols' });
  const ledgerFind = h('input', {
    class: 'sale-input', inputmode: 'numeric', placeholder: 'ဂဏန်း ရှာရန်', autocomplete: 'off',
  });
  ledgerFind.addEventListener('focus', (e) => e.target.select());
  ledgerFind.addEventListener('input', () => followLedgerFind(ledgerFind.value));
  ledgerFind.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); followLedgerFind(ledgerFind.value); }
  });

  let clockTimer;

  const customer = () => st.customers.find((u) => u.id === st.customerId) ?? st.customers[0];
  const betTypesFor = () => {
    const all = meta.bet_types.filter((bt) => bt.is_active);
    if (st.term?.game === '2D') return all.filter((bt) => bt.digits === 2);
    if (st.term?.game === '3D') return all.filter((bt) => bt.digits === 3);
    return all;
  };
  const typeById = () => new Map(meta.bet_types.map((bt) => [bt.id, bt]));
  const betType = () => typeById().get(st.typeId);
  const digits = () => betType()?.digits ?? 2;
  const open = () => isTermOpen(st.term, st.now);
  const unitPrice = () => st.term?.unit_price ?? 0;
  const totalUnits = () => st.cart.reduce((s, l) => s + l.unit * l.numbers.length, 0);
  const grossAmount = () => totalUnits() * unitPrice();

  async function confirmLeaveCart() {
    if (!st.cart.length) return true;
    return confirmDialog(t('Unsaved lines will be lost. Continue?'), { confirmLabel: t('Continue'), danger: false });
  }

  async function loadTerm(id) {
    if (!id) { st.term = null; return; }
    try { st.term = await api.get(`/terms/${id}`); } catch (err) { toast(err.message, 'bad'); st.term = null; return; }
    const types = betTypesFor();
    if (!types.some((bt) => bt.id === st.typeId)) st.typeId = types[0]?.id ?? null;
    st.held = readHeld(me.id, st.customerId, st.term.id);
    rebuildModes();
    await loadNextSlip();
    try { history.replaceState(null, '', `#/sale/${st.term.id}`); } catch { /* ignore */ }
    paintHot();
    paintBanner();
    paintHint();
    paintModes();
    ledgerFind.maxLength = digits();
    paintCart();
    paintStatus();
    await loadLedger();
  }

  function breakCap() {
    return (st.term?.limits ?? []).find((l) => l.bet_type_id === st.typeId)?.max_units ?? 0;
  }

  async function loadLedger() {
    if (!st.term || st.typeId == null) { st.ledgerUnits = new Map(); st.purchased = new Map(); paintLedger(); return; }
    const d = digits();
    try {
      const rows = await api.get(`/terms/${st.term.id}/exposure?bet_type_id=${st.typeId}`);
      st.ledgerUnits = new Map(rows.map((r) => [String(r.number).padStart(d, '0'), Number(r.units) || 0]));
    } catch { /* keep last totals */ }
    st.purchased = new Map();
    if (book) {
      try {
        const view = await api.get(`/terms/${st.term.id}/purchases`);
        for (const p of view.purchases ?? []) {
          if (p.bet_type_id !== st.typeId) continue;
          const num = String(p.number).padStart(d, '0');
          st.purchased.set(num, (st.purchased.get(num) ?? 0) + (Number(p.units) || 0));
        }
      } catch { /* extra still sold − break */ }
    }
    paintLedger();
    paintStatus();
  }

  function soldUnits(num) {
    let u = st.ledgerUnits.get(num) ?? 0;
    for (const l of st.cart) {
      if (l.bet_type_id === st.typeId && l.numbers.includes(num)) u += l.unit;
    }
    return u;
  }

  function extraUnits(num) {
    const cap = breakCap();
    if (!cap) return 0;
    return Math.max(0, soldUnits(num) - cap - (st.purchased.get(num) ?? 0));
  }

  function ledgerNumbers() {
    const d = digits();
    return Array.from({ length: 10 ** d }, (_, i) => String(i).padStart(d, '0'));
  }

  function ledgerTotals() {
    let all = 0;
    let extra = 0;
    for (const n of ledgerNumbers()) {
      all += soldUnits(n);
      extra += extraUnits(n);
    }
    let buy = 0;
    for (const v of st.purchased.values()) buy += v;
    const ledger = all - buy - extra;
    const cap = breakCap();
    return { all, buy, extra, ledger, cap, pct: cap ? Math.round(ledger / cap) : null };
  }

  function paintLedgerHead() {
    const on = (key) => st.ledgerSort === key ? ' on' : '';
    mount(ledgerCols,
      h('button', { type: 'button', class: `sale-ledger-sort${on('num')}`, onclick: () => { st.ledgerSort = 'num'; paintLedgerHead(); paintLedger(); } }, 'ဂဏန်း'),
      h('button', { type: 'button', class: `sale-ledger-sort${on('units')}`, onclick: () => { st.ledgerSort = 'units'; paintLedgerHead(); paintLedger(); } }, 'ယူနစ်'),
      h('span', {}, t('Extra')));
  }

  function paintLedger() {
    const keepTop = ledgerList.scrollTop;
    let nums = ledgerNumbers();
    if (st.ledgerSort === 'units') {
      nums = [...nums].sort((a, b) => (soldUnits(b) - soldUnits(a)) || extraUnits(b) - extraUnits(a) || a.localeCompare(b));
    }
    mount(ledgerList, nums.map((num) => {
      const u = soldUnits(num);
      const extra = extraUnits(num);
      return h('div', {
        class: `sale-ledger-row${num === st.ledgerFocus ? ' hit' : ''}${u ? ' has' : ''}${extra ? ' over' : ''}`,
        'data-num': num,
      },
        h('span', { class: 'sale-ledger-num' }, num),
        h('span', { class: 'sale-ledger-unit' }, money(u)),
        h('span', { class: 'sale-ledger-extra' }, money(extra)));
    }));
    ledgerList.scrollTop = keepTop;
  }

  function scrollLedger(num, smooth = true) {
    const row = ledgerList.querySelector(`[data-num="${CSS.escape(num)}"]`);
    if (!row) return;
    ledgerList.querySelectorAll('.hit').forEach((el) => el.classList.remove('hit'));
    row.classList.add('hit');
    const top = row.offsetTop - (ledgerList.clientHeight / 2) + (row.offsetHeight / 2);
    ledgerList.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  function followLedgerFind(raw) {
    const d = digits();
    const typed = String(raw || '').replace(/\D/g, '').slice(0, d);
    if (ledgerFind.value !== typed) ledgerFind.value = typed;
    if (!typed) {
      st.ledgerFocus = null;
      ledgerList.querySelectorAll('.hit').forEach((el) => el.classList.remove('hit'));
      return;
    }
    const nums = ledgerNumbers();
    const target = typed.length === d ? typed.padStart(d, '0') : nums.find((n) => n.startsWith(typed));
    if (!target) return;
    st.ledgerFocus = target;
    scrollLedger(target);
  }

  async function loadNextSlip() {
    if (!st.term || !st.customerId) { st.nextSlip = ''; return; }
    try {
      st.nextSlip = (await api.get(`/tickets/next-slip?term_id=${st.term.id}&user_id=${st.customerId}`)).slip_no;
    } catch { st.nextSlip = ''; }
    paintBanner();
  }

  function paintBanner() {
    const u = customer();
    slipBanner.textContent = `${u.username} - ${st.nextSlip || '…'}`;
    mount(bannerExtra,
      !open() && h('span', { class: 'active-chip', style: 'background:#b91c1c' }, '🔴 ပိတ်သွားပါပြီ'));
  }

  function paintHot() {
    const hot = st.term?.hot ?? [];
    if (!hot.length) { mount(hotHost); return; }
    const numbers = [...new Set(hot.map((x) => x.number))].sort();
    const text = numbers.join(', ');
    mount(hotHost,
      h('div', { class: 'hot-marquee' },
        h('span', { class: 'hot-marquee-label' }, '🔥 ဟော့ဂဏန်းများ:'),
        h('div', { class: 'hot-marquee-view', role: 'marquee', 'aria-label': text },
          h('div', { class: 'hot-marquee-track', style: `animation-duration:${Math.max(12, text.length * 0.18)}s` },
            h('span', {}, text))),
        h('button', { type: 'button', class: 'hot-marquee-btn', title: 'ဟော့ဂဏန်းများ ကြည့်ရန်', onclick: () => openHotModal(numbers) }, '🔥')));
  }

  function openHotModal(numbers) {
    openModal({
      title: '🔥 ဟော့ဂဏန်းများ',
      submitLabel: '📋 Copy',
      cancelLabel: t('Cancel'),
      body: h('textarea', { class: 'hot-textbox', readonly: true, rows: String(Math.min(12, Math.max(3, numbers.length))) }, numbers.join('\n')),
      onSubmit: async () => {
        if (await copyText(numbers.join('\n'))) toast(t('Copied {n} hot numbers', { n: numbers.length }));
        else throw new Error(t('Copy failed'));
      },
    });
  }

  function paintHint() {
    const d = digits();
    hintBox.textContent = st.rMode ? `${d === 3 ? 'သုံးလုံး' : 'နှစ်လုံး'}ပတ်လည်` : entryPatternHint(st.entryNumber, d);
  }

  const modeBtns = {};
  function paintModes() {
    for (const bt of betTypesFor()) {
      const btn = modeBtns[`t${bt.id}`];
      if (btn) btn.className = `btn btn-sm ${bt.id === st.typeId ? 'sale-mode-on' : 'sale-mode-off'}`;
    }
    if (modeBtns.R) modeBtns.R.className = `btn btn-sm ${st.rMode ? 'sale-mode-on' : 'sale-mode-off'}`;
    if (modeBtns.U) modeBtns.U.className = `btn btn-sm ${st.uMode ? 'sale-mode-on' : 'sale-mode-off'}`;
    if (modeBtns.Auto) modeBtns.Auto.className = `btn btn-sm ${st.autoMode ? 'sale-mode-on' : 'sale-mode-off'}`;
  }

  function paintCart() {
    const types = typeById();
    const rows = [...st.cart].reverse().flatMap((l) => {
      const expanded = st.expanded.has(l.rowId);
      const main = h('tr', { class: l.rowId === st.lastRowId ? 'sale-row-new' : null },
        h('td', {}, h('span', { class: 'badge badge-accent' }, types.get(l.bet_type_id)?.description ?? '')),
        h('td', { class: 'sale-num' },
          l.numbers.length > 1 && h('button', {
            type: 'button', class: 'sale-expand-btn',
            onclick: () => { if (st.expanded.has(l.rowId)) st.expanded.delete(l.rowId); else st.expanded.add(l.rowId); paintCart(); },
          }, expanded ? '▾' : '▸'),
          patternLabel(l.input) || l.input),
        h('td', {}, String(l.unit)),
        h('td', { class: 'sale-note' },
          l.numbers.length > 1 && h('button', { type: 'button', class: 'sale-group-btn', title: 'ဂဏန်းတစ်ကွက်ချင်း ခွဲရန်', onclick: () => ungroupLine(l) }, '🔗'),
          `${patternLabel(l.input) || l.input} ${l.unit}`),
        h('td', { class: 'sale-actions' },
          h('button', { type: 'button', class: 'sale-edit', title: t('Edit'), onclick: () => editLine(l) }, '✏️'),
          h('button', { type: 'button', class: 'sale-rm', title: t('Delete'), onclick: () => askDeleteLine(l) }, '🗑')));
      const extra = expanded
        ? h('tr', { class: 'sale-expand-row' },
          h('td', { colspan: '5' },
            h('div', { class: 'sale-expand-numbers' }, l.numbers.map((n) => h('span', { class: 'sale-num-chip' }, n)))))
        : null;
      return extra ? [main, extra] : [main];
    });
    mount(cartBox,
      h('div', { class: 'sale-table-scroll' },
        h('table', { class: 'sale-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'အမျိုးအစား'), h('th', {}, 'ဂဏန်း'), h('th', {}, 'ယူနစ်'), h('th', {}, 'မှတ်ချက်'), h('th', {}, 'Action'))),
          h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '5', class: 'sale-empty' }, 'ဂဏန်း မထည့်ရသေးပါ'))))));
    totalBox.replaceChildren(h('span', {}, `${totalUnits()} units`), h('span', {}, `${money(grossAmount())} Ks`));
    const canSave = open() && st.cart.length > 0 && !st.saving;
    saveBtn.disabled = !canSave;
    saveBtn.textContent = st.saving ? t('Saving…') : `✅ Save${st.cart.length ? ` · ${money(grossAmount())} Ks` : ''}`;
    holdBtn.hidden = !st.cart.length;
    holdBtn.textContent = '⏸ Hold';
    heldBtn.hidden = !st.held.length;
    heldBtn.textContent = `📂 Hold (${st.held.length}) — ပြန်ခေါ်ရန်`;
    paintStatus();
    paintLedger();
  }

  function paintStatus() {
    const u = customer();
    const tot = ledgerTotals();
    const clockText = `${st.now.toLocaleDateString('en-GB')} ${st.now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`;
    const pct = tot.pct == null ? '—' : `${money(tot.pct)}%`;
    mount(statusBar,
      h('div', { class: 'sale-status-left' },
        h('span', {}, `👤 ${u.username}`),
        h('span', { class: 'status-sep' }),
        h('span', {}, '💰 ', h('span', { class: u.balance < 0 ? 'ol-neg' : null }, money(u.balance)), u.unlimited ? ' ∞' : '')),
      h('div', { class: 'sale-status-center' },
        h('span', {}, `All ${money(tot.all)}`),
        h('span', { class: 'status-sep' }),
        h('span', {}, `Buy ${money(tot.buy)}`),
        h('span', { class: 'status-sep' }),
        h('span', { class: 'sale-stat-extra' }, `Extra ${money(tot.extra)}`),
        h('span', { class: 'status-sep' }),
        h('span', {}, `Ledger ${money(tot.ledger)} (${pct})`)),
      h('span', { class: 'sale-status-right' }, clockText));
  }

  function fail(message, field) {
    toast(message, 'bad');
    playSound('brakLimit');
    field?.current?.focus();
    field?.current?.select?.();
  }

  function tryAutoFocusUnit(raw) {
    if (!st.autoMode || st.uMode) return;
    if (parseEntry(raw, digits()).error) return;
    unitRef.current?.focus();
    unitRef.current?.select();
  }

  function setNumberInput(value) {
    const next = !st.rMode && value === 'R' && st.lastNumber.length === digits() ? `${st.lastNumber}RR` : value;
    st.entryNumber = next;
    if (numRef.current && numRef.current.value !== next) numRef.current.value = next;
    paintHint();
    tryAutoFocusUnit(next);
  }

  function pushCartLine(input, numbers) {
    const unit = Number(st.entryUnit);
    if (!Number.isInteger(unit) || unit < 1) return fail('ယူနစ် ထည့်ပါ', unitRef);
    const base = String(input).replace(/R+$/, '').replace(/A$/, '').replace(/-$/, '');
    if (/^\d+$/.test(base) && base.length === digits()) st.lastNumber = base;
    const rowId = `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    st.cart.push({ rowId, bet_type_id: st.typeId, input, numbers: [...numbers], unit });
    st.lastRowId = rowId;
    playSound('digitEntry');
    st.entryNumber = '';
    st.apayeReady = null;
    if (numRef.current) numRef.current.value = '';
    paintHint();
    paintCart();
    numRef.current?.focus();
  }

  function commitLine(input) {
    const parsed = parseEntry(input, digits());
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
    if (digits() !== 2 || st.rMode) return null;
    const m = /^(\d{3,})(-)?$/.exec(raw);
    return m ? { digits: m[1], withDoubles: !m[2] } : null;
  }

  function askApaye(digitStr, onYes) {
    const preview = expandApayePauk(digitStr, true);
    if (preview.error) return fail(preview.error, numRef);
    openModal({
      title: 'အပြီးခွေ',
      submitLabel: 'Yes',
      cancelLabel: 'No',
      focusSubmit: true,
      body: h('div', {},
        h('p', {}, `${digitStr} ကို အပြီးခွေ ရိုက်မှာလား?`),
        h('p', { style: 'font-weight:800;letter-spacing:.02em' }, preview.codes.join(', ')),
        h('p', { class: 'ol-muted' }, `${preview.numbers.length} ကွက်`)),
      onSubmit: async () => { onYes(); },
      onDismiss: (cancelled) => {
        requestAnimationFrame(() => {
          if (cancelled) {
            numRef.current?.focus();
            numRef.current?.select();
          } else {
            unitRef.current?.focus();
            unitRef.current?.select();
          }
        });
      },
    });
  }

  function afterNumberEnter() {
    const raw = st.entryNumber.trim().toUpperCase();
    const ap = readApaye(raw);
    if (ap) {
      if (hasRepeatDigits(ap.digits)) return fail('ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ', numRef);
      if (!ap.withDoubles) {
        st.apayeReady = raw;
        if (st.uMode && st.entryUnit) addToCart();
        else { unitRef.current?.focus(); unitRef.current?.select(); }
        return;
      }
      askApaye(ap.digits, () => { st.apayeReady = ap.digits; });
      return;
    }
    if (st.uMode && st.entryUnit) { addToCart(); return; }
    unitRef.current?.focus();
    unitRef.current?.select();
  }

  function addToCart() {
    if (!open()) return toast('ဤအပါတ်စဥ် ပိတ်သွားပါပြီ', 'bad');
    if (!betType()) return;
    const raw = st.entryNumber.trim().toUpperCase();
    if (!raw) return fail('ဂဏန်း ထည့်ပါ', numRef);
    const input = st.rMode && /^\d+$/.test(raw) ? `${raw}R` : raw;
    const unit = Number(st.entryUnit);
    if (!Number.isInteger(unit) || unit < 1) return fail('ယူနစ် ထည့်ပါ', unitRef);
    const ap = readApaye(input);
    if (ap) {
      if (hasRepeatDigits(ap.digits)) return fail('ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ', numRef);
      if (!ap.withDoubles) { commitApaye(ap.digits, false); return; }
      if (st.apayeReady === ap.digits) { commitApaye(ap.digits, true); return; }
      askApaye(ap.digits, () => { st.apayeReady = ap.digits; });
      return;
    }
    commitLine(input);
  }

  function removeLastCart() {
    if (!st.cart.length) return;
    const last = (st.lastRowId && st.cart.find((x) => x.rowId === st.lastRowId)) || st.cart[st.cart.length - 1];
    st.cart = st.cart.filter((x) => x.rowId !== last.rowId);
    st.expanded.delete(last.rowId);
    st.lastRowId = st.cart.length ? st.cart[st.cart.length - 1].rowId : null;
    playSound('brakLimit');
    paintCart();
  }

  function askDeleteLine(line) {
    const n = line.numbers?.length ?? 1;
    if (n < 2) {
      st.cart = st.cart.filter((x) => x.rowId !== line.rowId);
      playSound('brakLimit');
      paintCart();
      return;
    }
    openModal({
      title: 'Group ဖျက်မှာလား?',
      submitLabel: 'ဖျက်မည်',
      cancelLabel: 'မလုပ်တော့ပါ',
      danger: true,
      body: h('p', {}, h('b', {}, `${patternLabel(line.input) || line.input} ${line.unit}`), ` · ဂဏန်း ${n} လုံး တစ်ခါတည်း ပျက်ပါမည်။ ခွဲချင်ရင် မှတ်ချက်က 🔗 ကို နှိပ်ပါ။`),
      onSubmit: async () => { st.cart = st.cart.filter((x) => x.rowId !== line.rowId); playSound('brakLimit'); paintCart(); },
    });
  }

  function editLine(line) {
    const bt = typeById().get(line.bet_type_id);
    const d = bt?.digits ?? 2;
    const isGroup = line.numbers.length > 1;
    const num = h('input', { class: 'sale-input', value: isGroup ? patternLabel(line.input) : line.input, disabled: isGroup, maxlength: isGroup ? undefined : String(d) });
    const unit = h('input', { class: 'sale-input', value: String(line.unit), inputmode: 'numeric' });
    openModal({
      title: t('Edit'),
      submitLabel: t('Save'),
      body: h('div', { class: 'grid' },
        h('p', { class: 'ol-muted' }, `${bt?.description ?? ''}${isGroup ? ` · Group · ဂဏန်း ${line.numbers.length} လုံး — ယူနစ်သာ ပြင်နိုင်သည်` : ''}`),
        h('label', { class: 'sale-field' }, h('span', {}, 'ဂဏန်း'), num),
        h('label', { class: 'sale-field' }, h('span', {}, 'ယူနစ်'), unit),
        isGroup && h('button', { type: 'button', class: 'btn', onclick: () => {
          ungroupLine(line);
          document.querySelector('dialog.modal')?.close();
        } }, 'Ungroup')),
      onSubmit: async () => {
        const units = Number(unit.value);
        if (!Number.isInteger(units) || units < 1) throw new Error('ယူနစ် ထည့်ပါ');
        if (isGroup) {
          Object.assign(line, { unit: units });
        } else {
          const input = num.value.trim();
          if (!new RegExp(`^[0-9]{${d}}$`).test(input)) throw new Error(`ဂဏန်း ${d} လုံး ထည့်ပါ`);
          Object.assign(line, { input, numbers: [input], unit: units });
        }
        paintCart();
      },
    });
  }

  function ungroupLine(line) {
    const d = typeById().get(line.bet_type_id)?.digits ?? digits();
    const result = replaceGroupedCartLine(st.cart, line, d, (i) => `u-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`);
    if (!result.ok) {
      toast('ခွဲရန် ဂဏန်း မတွေ့ပါ', 'bad');
      return;
    }
    st.expanded.delete(line.rowId);
    st.cart = result.cart;
    paintCart();
  }

  function holdSlip() {
    if (!st.cart.length || !st.term) return;
    const no = nextHoldNo(me.id, st.customerId, st.term.id);
    st.held = [...st.held, { no, at: new Date().toISOString(), lines: st.cart }];
    writeHeld(me.id, st.customerId, st.term.id, st.held);
    st.cart = [];
    st.expanded = new Set();
    paintCart();
    toast(`Hold #${no}`);
  }

  function showHeld() {
    const body = h('div', { class: 'held-list' },
      st.cart.length > 0 && h('div', { class: 'ol-muted', style: 'margin-bottom:10px' },
        'လက်ရှိ slip ရိုက်နေဆဲဖြစ်၍ "ပေါင်းထည့်မည်" ဖြင့် Hold slip ကို လက်ရှိ slip ထဲ ပေါင်းထည့်နိုင်ပါသည်'),
      st.held.map((item) => {
        const units = item.lines.reduce((sum, l) => sum + l.unit * l.numbers.length, 0);
        return h('div', { class: 'held-row' },
          h('div', { class: 'held-info' },
            h('b', {}, `Hold #${item.no}`),
            h('span', { class: 'ol-muted' }, ` · ${dateTime(item.at)} · ${item.lines.length} ကြောင်း · ${units} units · ${money(units * unitPrice())} Ks`)),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
            if (st.cart.length) st.cart = [...st.cart, ...item.lines.map((l) => ({ ...l, rowId: `${Date.now()}-${Math.random()}` }))];
            else st.cart = item.lines;
            dropHeld(item);
            document.querySelector('dialog.modal')?.close();
            paintCart();
          } }, st.cart.length ? '➕ ပေါင်းထည့်မည်' : 'ပြန်ခေါ်မည်'),
          h('button', { type: 'button', class: 'sale-rm', title: 'Hold ဖျက်မည်', onclick: () => { dropHeld(item); document.querySelector('dialog.modal')?.close(); showHeld(); } }, '🗑'));
      }));
    openModal({ title: '⏸ Hold slip များ', body, submitLabel: t('Close'), cancelLabel: t('Close'), onSubmit: async () => {} });
  }

  function dropHeld(item) {
    st.held = st.held.filter((x) => x.no !== item.no);
    writeHeld(me.id, st.customerId, st.term.id, st.held);
    paintCart();
  }

  function showSaved(ticket) {
    const types = typeById();
    openModal({
      title: '✅ သိမ်းပြီးပါပြီ',
      submitLabel: '🧾 ဆက်ရောင်းမည်',
      cancelLabel: t('Close'),
      body: h('div', {},
        h('div', { class: 'ol-slip-head' },
          h('div', {}, 'စလစ် ', h('b', {}, ticket.slip_no)),
          h('div', { class: 'ol-muted' }, `${st.term.description} · ${dateTime(ticket.created_at)}`)),
        ticket.adjustments?.length > 0 && h('div', { class: 'ol-adjust' },
          h('div', { class: 'ol-adjust-title' }, 'မရဂဏန်းများ'),
          ticket.adjustments.map((a) => h('div', { class: 'ol-adjust-row' }, h('b', {}, a.number), ` - ${adjustmentText(a)}`))),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'အမျိုးအစား'), h('th', {}, 'ဂဏန်း'), h('th', { class: 'num' }, 'ယူနစ်'), h('th', { class: 'num' }, 'ပမာဏ'))),
            h('tbody', {}, ticket.items.map((i) => h('tr', {},
              h('td', {}, types.get(i.bet_type_id)?.description ?? i.bet_type),
              h('td', {}, h('b', {}, i.number)),
              h('td', { class: 'num' }, String(i.units)),
              h('td', { class: 'num' }, money(i.amount))))))),
        h('div', { class: 'ol-totals' },
          h('div', { class: 'ol-total ol-total-main' }, h('span', {}, 'Total'), h('b', {}, `${money(ticket.gross_amount)} ကျပ်`)))),
      onSubmit: async () => {},
    });
  }

  async function save() {
    if (!st.term || !st.cart.length) return;
    st.saving = true;
    paintCart();
    try {
      const ticket = await api.post('/tickets', {
        term_id: st.term.id,
        user_id: st.customerId,
        entries: toEntries(st.cart),
        ...(canOver && st.saveOver ? { save_over: true } : {}),
      });
      playSound('checkOut');
      st.cart = [];
      st.expanded = new Set();
      st.saving = false;
      paintCart();
      await loadLedger();
      await loadNextSlip();
      const fresh = await api.get(`/users/${st.customerId}`).catch(() => null);
      if (fresh) {
        const i = st.customers.findIndex((u) => u.id === fresh.id);
        if (i >= 0) st.customers[i] = fresh;
        paintStatus();
      }
      showSaved(ticket);
    } catch (err) {
      toast(err.message, 'bad');
      playSound('brakLimit');
    } finally {
      st.saving = false;
      paintCart();
      numRef.current?.focus();
    }
  }

  saveBtn.addEventListener('click', save);
  holdBtn.addEventListener('click', holdSlip);
  heldBtn.addEventListener('click', showHeld);

  if (canOver) {
    const box = h('input', { type: 'checkbox' });
    box.addEventListener('change', () => { st.saveOver = box.checked; });
    overBox.append(box, h('span', {}, t('Save over-limit')));
  }

  const comboList = h('div', { class: 'sale-combo-list', hidden: true });
  const customerInput = h('input', {
    class: 'sale-input', autocomplete: 'off', spellcheck: 'false',
    placeholder: t('Customer'), value: customer().username,
  });
  const customerCombo = h('div', { class: 'sale-combo' }, customerInput, comboList);

  function filterCustomers(q) {
    const s = q.trim().toLowerCase();
    if (!s) return st.customers;
    const start = [];
    const rest = [];
    for (const u of st.customers) {
      const name = u.username.toLowerCase();
      if (name.startsWith(s)) start.push(u);
      else if ([u.username, u.name, u.phone].some((v) => v && String(v).toLowerCase().includes(s))) rest.push(u);
    }
    return [...start, ...rest];
  }
  function hideCombo() { comboList.hidden = true; st.comboIndex = -1; }
  function showCombo(q = customerInput.value) {
    const list = filterCustomers(q);
    if (st.comboIndex < 0 || st.comboIndex >= list.length) {
      st.comboIndex = Math.max(0, list.findIndex((u) => u.id === st.customerId));
    }
    mount(comboList, list.length
      ? list.map((u, i) => h('button', {
        type: 'button',
        class: `sale-combo-item${i === st.comboIndex ? ' on' : ''}`,
        onmousedown: (e) => { e.preventDefault(); pickCustomer(u); },
      }, u.username))
      : h('div', { class: 'sale-combo-empty' }, t('Nothing here yet')));
    comboList.hidden = false;
  }
  async function pickCustomer(u) {
    hideCombo();
    if (!u) return;
    if (u.id === st.customerId) { customerInput.value = u.username; return; }
    if (!(await confirmLeaveCart())) { customerInput.value = customer().username; return; }
    st.cart = [];
    st.customerId = u.id;
    customerInput.value = u.username;
    st.held = st.term ? readHeld(me.id, st.customerId, st.term.id) : [];
    paintCart();
    paintStatus();
    paintBanner();
    await loadNextSlip();
    numRef.current?.focus();
  }
  customerInput.addEventListener('focus', () => { customerInput.select(); st.comboIndex = -1; showCombo(''); });
  customerInput.addEventListener('input', () => { st.comboIndex = 0; showCombo(customerInput.value); });
  customerInput.addEventListener('keydown', (e) => {
    const list = filterCustomers(customerInput.value);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (comboList.hidden) showCombo(customerInput.value);
      st.comboIndex = Math.min((st.comboIndex < 0 ? -1 : st.comboIndex) + 1, list.length - 1);
      showCombo(customerInput.value);
      comboList.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      st.comboIndex = Math.max(0, (st.comboIndex < 0 ? 0 : st.comboIndex) - 1);
      showCombo(customerInput.value);
      comboList.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const typed = customerInput.value.trim().toLowerCase();
      const exact = list.find((x) => x.username.toLowerCase() === typed);
      pickCustomer(exact || list[st.comboIndex] || list[0]).then(() => numRef.current?.focus());
    } else if (e.key === 'Escape') {
      customerInput.value = customer().username;
      hideCombo();
    }
  });
  customerInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!comboList.hidden && comboList.contains(document.activeElement)) return;
      hideCombo();
      const typed = customerInput.value.trim().toLowerCase();
      const exact = st.customers.find((x) => x.username.toLowerCase() === typed);
      if (exact) pickCustomer(exact);
      else customerInput.value = customer().username;
    }, 80);
  });

  function termLocked() {
    return ['drawn', 'settled', 'cancelled'].includes(st.term?.status);
  }

  async function editBreak() {
    if (!st.term || !book) return;
    if (termLocked()) { toast('ဒီအပါတ်စဥ် ဘရိတ် ပြင်လို့ မရတော့ပါ', 'bad'); return; }
    const types = betTypesFor();
    if (!types.length) return;
    const current = new Map((st.term.limits ?? []).map((l) => [l.bet_type_id, l.max_units]));
    const fields = types.map((bt) => {
      const input = h('input', { class: 'sale-input', type: 'number', min: '0', step: '1', value: String(current.get(bt.id) ?? 0) });
      return { bt, input };
    });
    openModal({
      title: 'ဘရိတ် ပြင်မည်',
      submitLabel: 'သိမ်းမည်',
      body: h('div', { class: 'grid' },
        h('p', { class: 'ol-muted' }, 'ဂဏန်းတစ်ကွက်ကို စလစ်အားလုံးပေါင်း အများဆုံး ယူနစ်။ 0 = ကန့်သတ်ချက်မရှိ။'),
        ...fields.map(({ bt, input }) => h('label', { class: 'sale-field' },
          h('span', {}, `${bt.description} — ယူနစ်`), input))),
      onSubmit: async () => {
        const keep = new Map((st.term.limits ?? []).map((l) => [l.bet_type_id, l.max_units]));
        for (const { bt, input } of fields) {
          const n = Number(input.value);
          if (!Number.isInteger(n) || n < 0) throw new Error('ယူနစ် 0 နှင့်အထက် ထည့်ပါ');
          if (n > 0) keep.set(bt.id, n);
          else keep.delete(bt.id);
        }
        const rows = [...keep.entries()].map(([bet_type_id, max_units]) => ({ bet_type_id, max_units }));
        await api.put(`/terms/${st.term.id}/limits`, rows);
        toast('ဘရိတ် သိမ်းပြီး');
        st.term = await api.get(`/terms/${st.term.id}`);
        paintStatus();
        paintLedger();
      },
    });
  }

  const breakBtn = h('button', { type: 'button', class: 'btn btn-sm sale-banner-btn' }, 'ဘရိတ်');
  breakBtn.hidden = !book;
  breakBtn.addEventListener('click', () => editBreak());

  const buyBtn = h('button', { type: 'button', class: 'btn btn-sm sale-banner-btn' }, 'အဝယ် သွင်း');
  buyBtn.hidden = !book;
  buyBtn.addEventListener('click', async () => {
    if (!st.term || !book) return;
    buyBtn.disabled = true;
    try {
      const data = await api.get(`/terms/${st.term.id}/purchases`);
      if (data.has_results) { toast('ပေါက်သီး ထည့်ပြီးနောက် အဝယ် အသစ် မရိုက်နိုင်ပါ။', 'bad'); return; }
      const items = (data.excess ?? []).filter((r) => r.excess > 0)
        .map((r) => ({ bet_type_id: r.bet_type_id, number: r.number, units: r.excess }));
      if (!items.length) { toast('ကျွံဂဏန်း မရှိပါ', 'bad'); return; }
      const units = items.reduce((a, i) => a + i.units, 0);
      if (!(await confirmDialog(
        `ကျွံဂဏန်း ${items.length} လုံး · ${money(units)} ယူနစ် (${money(units * data.unit_price)} Ks) ကို အဝယ်သွင်းမလား?`,
        { title: 'အဝယ် သွင်း', confirmLabel: 'အဝယ် သွင်း', danger: false },
      ))) return;
      await api.post(`/terms/${st.term.id}/purchases`, { items });
      toast('အဝယ် သိမ်းပြီး');
      await loadLedger();
    } catch (err) { toast(err.message, 'bad'); }
    finally { buyBtn.disabled = false; }
  });

  const termSelect = h('select', { class: 'sale-input sale-term-select' },
    st.terms.map((tm) => h('option', { value: String(tm.id), selected: tm.id === initialTermId }, `${tm.description} (${tm.game})`)));
  if (initialTermId && !st.terms.some((tm) => tm.id === initialTermId)) {
    termSelect.prepend(h('option', { value: String(initialTermId), selected: true }, `#${initialTermId}`));
  }
  termSelect.addEventListener('change', async () => {
    const next = Number(termSelect.value);
    if (st.term?.id === next) return;
    if (!(await confirmLeaveCart())) { termSelect.value = String(st.term?.id ?? ''); return; }
    st.cart = [];
    await loadTerm(next);
    paintCart();
  });

  const types = /* first guess 2D */ (meta.bet_types || []).filter((bt) => bt.is_active && bt.digits === 2);
  const seedTypes = types.length ? types : (meta.bet_types || []).filter((bt) => bt.is_active);
  const modeRow = h('div', { class: 'sale-mode-row' });
  function rebuildModes() {
    const list = betTypesFor();
    const btns = list.map((bt) => {
      const btn = h('button', { type: 'button', class: `btn btn-sm ${bt.id === st.typeId ? 'sale-mode-on' : 'sale-mode-off'}` }, bt.code);
      btn.addEventListener('click', () => {
        st.typeId = bt.id;
        paintModes();
        paintHint();
        loadLedger().catch(() => {});
        ledgerFind.maxLength = digits();
        followLedgerFind(ledgerFind.value);
        numRef.current?.focus();
      });
      modeBtns[`t${bt.id}`] = btn;
      return btn;
    });
    const r = h('button', { type: 'button', class: 'btn btn-sm sale-mode-off', title: 'R — ဂဏန်းတိုင်းကို အပြန်အလှန် (R) အဖြစ် ထည့်မည်' }, 'R');
    r.addEventListener('click', () => { st.rMode = !st.rMode; paintModes(); paintHint(); numRef.current?.focus(); });
    const u = h('button', { type: 'button', class: 'btn btn-sm sale-mode-off', title: 'U — ယူနစ် မပြောင်းဘဲ ဂဏန်းမှာ Enter နှိပ်တာနဲ့ ထည့်မည်' }, 'U');
    u.addEventListener('click', () => { st.uMode = !st.uMode; if (st.uMode) st.autoMode = false; paintModes(); numRef.current?.focus(); });
    const a = h('button', { type: 'button', class: 'btn btn-sm sale-mode-off', title: 'Auto — ဂဏန်း/ပုံစံ ပြည့်တာနဲ့ Unit သို့ ခုန်မည်' }, 'Auto');
    a.addEventListener('click', () => { st.autoMode = !st.autoMode; if (st.autoMode) st.uMode = false; paintModes(); numRef.current?.focus(); });
    modeBtns.R = r; modeBtns.U = u; modeBtns.Auto = a;
    modeRow.replaceChildren(...btns, r, u, a);
  }
  st.typeId = seedTypes[0]?.id ?? null;
  rebuildModes();

  const numInput = h('input', {
    class: 'sale-input big', autocomplete: 'off', spellcheck: 'false', maxlength: '12',
  });
  numInput.title = 'Allowed: 0-9 R * S M P W / + T K B N -';
  numRef.current = numInput;
  numInput.addEventListener('focus', (e) => e.target.select());
  numInput.addEventListener('input', (e) => setNumberInput(st.rMode ? e.target.value.replace(/[^0-9]/g, '') : normalizeEntryInput(e.target.value)));
  numInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      afterNumberEnter();
      return;
    }
    if (st.rMode) return;
    const ch = PATTERN_KEYS[e.code];
    if (ch && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const el = e.target;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      setNumberInput((el.value.slice(0, start) + ch + el.value.slice(end)).toUpperCase());
      requestAnimationFrame(() => { const pos = Math.min(start + 1, el.value.length); el.setSelectionRange(pos, pos); });
    }
  });

  const unitInput = h('input', { class: 'sale-input sale-unit-input big', type: 'number', min: '1', inputmode: 'numeric', style: 'text-align:right' });
  unitRef.current = unitInput;
  unitInput.addEventListener('focus', (e) => e.target.select());
  unitInput.addEventListener('input', (e) => { st.entryUnit = e.target.value.replace(/[^0-9]/g, ''); e.target.value = st.entryUnit; });
  unitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addToCart(); return; }
    if ((e.code === 'KeyR' || e.code === 'Slash' || e.code === 'NumpadDivide') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const raw = st.entryNumber.trim();
      if (/^[0-9]+$/.test(raw) && raw.length === digits()) { e.preventDefault(); setNumberInput(`${raw}R`); }
    }
  });

  mount(main,
    h('div', { class: 'sale-page ol-sale' },
      h('div', { class: 'sale-page-body' },
        h('div', { class: 'sale-term-banner', style: 'background:linear-gradient(135deg,#065f46,#059669)' },
          h('b', {}, 'အပါတ်စဉ်:'),
          termSelect,
          bannerExtra,
          h('div', { style: 'display:flex;gap:8px;margin-left:auto;align-items:center' },
            book && breakBtn,
            book && buyBtn,
            h('a', { class: 'btn btn-sm sale-banner-btn', href: '#/terms' }, t('Terms')))),
        hotHost,
        h('div', { class: 'sale-panels' },
          h('div', { class: 'sale-panel sale-entry-panel', style: 'background:#dcfce7' },
            h('div', { class: 'sale-field' }, h('label', {}, t('Customer')), customerCombo),
            modeRow,
            hintBox,
            h('div', { class: 'sale-num-unit-row' },
              h('div', { class: 'sale-field' }, h('label', {}, 'ဂဏန်း (Number)'), numInput),
              h('div', { class: 'sale-field' }, h('label', {}, 'ယူနစ် (Unit)'), unitInput)),
            totalBox,
            canOver && overBox,
            saveBtn,
            holdBtn,
            heldBtn),
          h('div', { class: 'sale-panel sale-display-panel' }, slipBanner, cartBox),
          h('div', { class: 'sale-panel sale-ledger-panel' },
            h('div', { class: 'sale-ledger-head' },
              h('b', {}, t('Ledger')),
              ledgerFind,
              ledgerCols),
            ledgerList)),
        statusBar)));

  paintLedgerHead();
  paintCart();
  await loadTerm(Number(termSelect.value) || initialTermId);
  rebuildModes();
  paintModes();
  paintHint();
  ledgerFind.maxLength = digits();
  numInput.focus();

  clockTimer = setInterval(() => {
    st.now = new Date();
    paintStatus();
    if (st.term && !open()) paintBanner();
  }, 1000);
  const stopLive = onLive('tickets', (msg) => {
    if (msg.reconnected || !msg.term_id || msg.term_id === st.term?.id) loadLedger().catch(() => {});
  });
  const shell = main.closest('.shell');
  shell?.classList.add('shell-sale');
  function onAltDelete(e) {
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    if (e.key !== 'Delete' && e.code !== 'Delete') return;
    if (document.querySelector('dialog.modal[open], dialog[open]')) return;
    e.preventDefault();
    removeLastCart();
  }
  window.addEventListener('keydown', onAltDelete);
  window.addEventListener('hashchange', stop, { once: true });
  function stop() {
    clearInterval(clockTimer);
    stopLive();
    window.removeEventListener('keydown', onAltDelete);
    shell?.classList.remove('shell-sale');
    main.classList.remove('main-sale');
  }
}
