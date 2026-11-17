// Shared pieces of the phone screens (the online-mobile app's "Dash" look): the full-screen indigo
// frame with its app bar, and the small widgets the screens share.
import React, { useEffect } from 'react';
import { useOnline } from '../onlineContext.jsx';
import { setBackHandler } from './bridge.js';
import './mobile.css';

// One phone screen: app bar (← back unless `home`, title, actions on the right) over a scrolling body.
export function MScreen({ title, back = '/', home, actions, children, scroll = true }) {
  const { guardedNavigate } = useOnline();
  // The phone's back button inside the host app does what ← does (the dashboard has none: exit).
  useEffect(() => (home ? undefined : setBackHandler(() => guardedNavigate(back))), [home, back, guardedNavigate]);
  return (
    <div className="m-screen">
      <header className="m-appbar">
        {!home && <button type="button" className="m-icon-btn" aria-label="Back" onClick={() => guardedNavigate(back)}>←</button>}
        <b className="m-appbar-title">{title}</b>
        {actions}
      </header>
      <div className={scroll ? 'm-body' : 'm-body-fixed'}>{children}</div>
    </div>
  );
}

export const MIconButton = ({ label, onClick, children, disabled }) => (
  <button type="button" className="m-icon-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>
);

export const GameCircle = ({ game, size = 28 }) => (
  <span className="m-game" style={{ width: size, height: size, fontSize: size * 0.4 }}>{game === '2D3D' ? '2·3' : game}</span>
);

export const StatusChip = ({ label, color }) => (
  <span className="m-chip" style={{ color, borderColor: color }}>{label}</span>
);

export const MLoading = () => <div className="m-note"><span className="m-spinner" /></div>;
export const MError = ({ message, onRetry }) => (
  <div className="m-note">
    <div>⚠️ {message}</div>
    {onRetry && <button type="button" className="m-pill-btn" onClick={onRetry}>ပြန်ကြိုးစားရန်</button>}
  </div>
);
export const MEmpty = ({ children }) => <div className="m-note m-muted">{children}</div>;

// A select box on the indigo background.
export function MSelect({ label, value, onChange, disabled, children }) {
  return (
    <label className={`m-select ${disabled ? 'off' : ''}`}>
      <small>{label}</small>
      <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

// ဖိုင် → အပါတ်စဥ် boxes (slips and report screens), as online-mobile's FolderTermFilter: folders and
// terms come from the rows shown and, when given, from allTerms (GET /terms) so a picked folder lists
// all of its terms. The term box is off until a folder is picked. Folder 0 = terms without one.
export const matchesFolderTerm = (row, folderId, termId) =>
  (folderId == null || Number(row.folder_id ?? 0) === folderId) && (termId == null || Number(row.term_id) === termId);

export function FolderTermFilter({ rows, allTerms = [], termNameKey, folderId, termId, onChange }) {
  const folders = new Map();
  const terms = new Map();
  for (const r of rows) {
    const f = Number(r.folder_id ?? 0);
    if (!folders.has(f)) folders.set(f, r.folder_name ?? 'ဖိုင်မရှိ');
    if (folderId != null && f === folderId && !terms.has(Number(r.term_id))) terms.set(Number(r.term_id), r[termNameKey]);
  }
  for (const t of allTerms) {
    const f = Number(t.folder_id ?? 0);
    if (!folders.has(f)) folders.set(f, t.folder_name ?? (f === 0 ? 'ဖိုင်မရှိ' : `ဖိုင် #${f}`));
    if (folderId != null && f === folderId && !terms.has(Number(t.id))) terms.set(Number(t.id), t.description);
  }
  const num = (v) => (v === '' ? null : Number(v));
  return (
    <div className="m-filter-row">
      <MSelect label="ဖိုင်" value={folders.has(folderId) ? folderId : ''} onChange={(v) => onChange(num(v), null)}>
        <option value="">ဖိုင် အားလုံး</option>
        {[...folders].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </MSelect>
      <MSelect label="အပါတ်စဥ်" value={terms.has(termId) ? termId : ''} disabled={folderId == null} onChange={(v) => onChange(folderId, num(v))}>
        <option value="">{folderId == null ? 'ဖိုင် အရင်ရွေးပါ' : 'အပါတ်စဥ် အားလုံး'}</option>
        {[...terms].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </MSelect>
    </div>
  );
}

// A bottom sheet (white, over a dim backdrop) — the Flutter app's showModalBottomSheet.
export function MSheet({ onClose, children }) {
  return (
    <>
      <div className="m-backdrop" onClick={onClose} />
      <div className="m-sheet-pop" role="dialog">{children}</div>
    </>
  );
}
