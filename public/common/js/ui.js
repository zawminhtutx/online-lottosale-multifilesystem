// Tiny DOM helpers: h() builds elements, plus modal, toast, table and formatting helpers.
import { t } from './i18n.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  const props = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value' || key === 'checked') props[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  Object.assign(el, props); // after children so <select value> finds its <option>
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
}

// ---------- formatting ----------

export const money = (n) => Number(n ?? 0).toLocaleString('en-US');

// SQLite datetime('now') is UTC without a zone marker.
export function parseDate(value) {
  if (!value) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}

// Dates are shown and typed as dd-mm-yyyy HH:mm (local time) everywhere.
const pad2 = (n) => String(n).padStart(2, '0');
const formatLocal = (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export function dateTime(value) {
  const d = parseDate(value);
  return d ? formatLocal(d) : '—';
}

// Value for dateTimeInput: "dd-mm-yyyy HH:mm".
export function toLocalInput(value) {
  const d = parseDate(value);
  return d ? formatLocal(d) : '';
}

// "dd-mm-yyyy HH:mm" (or "dd-mm-yyyy", or a datetime-local value) -> ISO string; '' -> null.
export function parseLocalInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?$/);
  if (!m && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return undefined; // never guess US-style dates
  const d = m
    ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0))
    : new Date(text);
  if (Number.isNaN(d.getTime()) || (m && (d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1))) return undefined;
  return d.toISOString();
}

export function fromLocalInput(value) {
  const iso = parseLocalInput(value);
  if (iso === undefined) throw new Error(t('Dates must look like dd-mm-yyyy HH:mm, e.g. {example}', { example: formatLocal(new Date()) }));
  return iso;
}

// Date + time field shown as dd-mm-yyyy HH:mm. The 📅 button opens the browser's own calendar
// (a hidden datetime-local input) and writes the picked date back in that format.
export function dateTimeInput(name, value = '', attrs = {}) {
  const text = h('input', { name, value, placeholder: 'dd-mm-yyyy HH:mm', autocomplete: 'off', ...attrs });
  const native = h('input', { type: 'datetime-local', tabindex: '-1', 'aria-hidden': 'true', class: 'dt-native' });
  native.addEventListener('change', () => {
    if (native.value) text.value = formatLocal(new Date(native.value));
  });
  const button = h('button', { type: 'button', class: 'icon-btn dt-btn', title: t('Calendar'), 'aria-label': t('Calendar'), onclick: () => {
    const iso = parseLocalInput(text.value);
    const d = iso ? new Date(iso) : new Date();
    native.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    try { native.showPicker(); } catch { native.focus(); }
  } }, '📅');
  return h('span', { class: 'dt-field' }, text, native, button);
}

const BADGE_TONES = {
  active: 'good', open: 'good', won: 'good',
  suspended: 'warn', closed: 'warn', drawn: 'warn', draft: 'muted',
  settled: 'info', lost: 'muted',
  cancelled: 'bad',
  admin: 'info', agent: 'accent', user: 'muted',
};
// Balance with a red minus when in credit, plus an ∞ tag for unlimited accounts.
export function balanceCell(account) {
  return h('span', { class: 'balance-cell' },
    h('span', { class: account.balance < 0 ? 'amount-neg' : null }, money(account.balance)),
    account.unlimited ? h('span', { class: 'badge badge-accent', title: t('Unlimited wallet') }, '∞') : null);
}

// Checkbox with its label on the right; value "on" when checked (FormData convention).
export const checkbox = (name, label, checked, hint) =>
  h('label', { class: 'check' },
    h('input', { type: 'checkbox', name, checked: !!checked }),
    h('span', {}, h('span', { class: 'check-label' }, label), hint && h('small', { class: 'hint' }, hint)));

export const badge = (text) => h('span', { class: `badge badge-${BADGE_TONES[text] ?? 'muted'}` }, t(text));

// ---------- table ----------

// columns: [{ label, key?, render?(row), align?: 'right' }]
export function table(columns, rows, { empty = t('Nothing here yet'), onRowClick } = {}) {
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.align === 'right' ? 'num' : null }, c.label)))),
      h('tbody', {},
        rows.length
          ? rows.map((row) =>
              h('tr', { class: onRowClick ? 'clickable' : null, onclick: onRowClick && (() => onRowClick(row)) },
                columns.map((c) => h('td', { class: c.align === 'right' ? 'num' : null }, c.render ? c.render(row) : row[c.key] ?? '—'))))
          : h('tr', {}, h('td', { colspan: columns.length, class: 'empty' }, empty)))));
}

// ---------- forms ----------

export const field = (label, control, hint) =>
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('small', { class: 'hint' }, hint));

export const input = (name, attrs = {}) => h('input', { name, ...attrs });

export const select = (name, options, value, attrs = {}) =>
  h('select', { name, value: value == null ? '' : String(value), ...attrs },
    options.map(([v, label]) => h('option', { value: String(v) }, label)));

export function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Disables the submit button and shows errors inline while an async action runs.
export async function busy(button, fn) {
  const errorBox = button.closest('form, .card, dialog')?.querySelector('.form-error');
  if (errorBox) errorBox.textContent = '';
  button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    if (errorBox) errorBox.textContent = err.message;
    else toast(err.message, 'bad');
    throw err;
  } finally {
    button.disabled = false;
  }
}

// ---------- modal ----------

// Opens a <dialog> with a form. onSubmit(values, form) may throw to keep it open.
export function openModal({ title, body, submitLabel = t('Save'), cancelLabel = t('Cancel'), danger = false, onSubmit, wide = false, focusSubmit = false, onDismiss } = {}) {
  const errorBox = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, submitLabel);
  const dialog = h('dialog', { class: wide ? 'modal modal-wide' : 'modal' });
  let submitted = false;
  const form = h('form', { method: 'dialog' },
    h('header', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Close'), onclick: () => dialog.close() }, '✕')),
    h('div', { class: 'modal-body' }, body),
    errorBox,
    onSubmit && h('footer', { class: 'modal-foot' },
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, cancelLabel),
      submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) { submitted = true; return dialog.close(); }
    try {
      await busy(submit, () => onSubmit(formValues(form), form));
      submitted = true;
      dialog.close();
    } catch { /* error shown in errorBox */ }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onDismiss?.(!submitted);
  });
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  if (focusSubmit) submit.focus();
  else form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return dialog;
}

export function confirmDialog(message, { title = t('Are you sure?'), confirmLabel = t('Confirm'), danger = true } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const dialog = openModal({
      title,
      body: h('p', {}, message),
      submitLabel: confirmLabel,
      danger,
      onSubmit: async () => { ok = true; },
    });
    dialog.addEventListener('close', () => resolve(ok));
  });
}

// ---------- toast ----------

export function toast(message, tone = 'good') {
  let host = document.getElementById('toasts');
  if (!host) document.body.append((host = h('div', { id: 'toasts', 'aria-live': 'polite' })));
  const el = h('div', { class: `toast toast-${tone}` }, message);
  host.append(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- misc ----------

// Highlights one sidebar link (for detail pages the route alone can't decide).
export function activateNav(href) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === href));
}

export const pageHeader = (title, subtitle, ...actions) =>
  h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), subtitle && h('p', { class: 'muted' }, subtitle)),
    h('div', { class: 'actions' }, actions));

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' },
    items.map(([key, label]) =>
      h('button', { type: 'button', role: 'tab', class: key === active ? 'tab active' : 'tab', 'aria-selected': String(key === active), onclick: () => onChange(key) }, label)));
}
