// စာရင်းများကြည့် — online-mobile's ReportScreen: the user's own betting per term, filtered by
// ဖိုင် → အပါတ်စဥ် (here) and ငွေရှင်း (on the server). 📤 shares the totals as text.
import React, { useEffect, useState } from 'react';
import { useToast } from '../components/ui.jsx';
import { onlineApi } from '../onlineApi.js';
import { dateTime, money } from '../format.js';
import { shareText } from '../share.js';
import { FolderTermFilter, GameCircle, MEmpty, MError, MIconButton, MLoading, MScreen, MSelect, StatusChip, matchesFolderTerm } from './MobileShell.jsx';

const TERM_STATUS = {
  open: ['ဖွင့်ထား', '#2563eb'], closed: ['ပိတ်ပြီး', '#64748b'], drawn: ['ဂဏန်းထွက်ပြီး', '#d97706'],
  settled: ['ဆုငွေရှင်းပြီး', '#059669'],
};
const GREEN = '#059669';
const RED = '#dc2626';
const signed = (n) => `${n > 0 ? '+' : ''}${money(n)}`;

export default function MobileReports() {
  const toast = useToast();
  const [folderId, setFolderId] = useState(null);
  const [termId, setTermId] = useState(null);
  const [cleared, setCleared] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const view = (c = cleared) => {
    setLoading(true);
    onlineApi(`/reports/mine${c ? `?cleared=${c}` : ''}`)
      .then((r) => { setRows(r); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { view(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (rows ?? []).filter((r) => matchesFolderTerm(r, folderId, termId));
  const total = (key) => shown.reduce((a, r) => a + Number(r[key] || 0), 0);
  // Profit / loss counts settled terms only — the others have no winnings yet.
  const result = shown.filter((r) => r.status === 'settled').reduce((a, r) => a + Number(r.result || 0), 0);

  async function send() {
    const lines = ['Online Lotto — စာရင်း', '----------------------'];
    for (const r of shown) {
      lines.push(`${r.description} (${r.game})`, `  စလစ် ${r.tickets} · ထိုးငွေ ${money(r.net)} · ဆုငွေ ${money(r.win)}`);
    }
    lines.push('----------------------', `ထိုးငွေ: ${money(total('net'))} Ks`, `ဆုငွေ: ${money(total('win'))} Ks`, `အမြတ်/အရှုံး: ${money(result)} Ks`);
    const r = await shareText(lines.join('\n'));
    if (r === 'copied') toast('Text ကို Copy ကူးပြီးပါပြီ', 'success');
    else if (r === 'failed') toast('ပို့ရန် မအောင်မြင်ပါ', 'error');
  }

  let body;
  if (loading && !rows) body = <MLoading />;
  else if (error) body = <MError message={error} onRetry={() => view()} />;
  else if (!shown.length) body = <MEmpty>အချက်အလက် မရှိသေးပါ</MEmpty>;
  else {
    body = (
      <div className="m-pad-x">
        <div className="m-stats">
          <Stat label="စလစ်" value={money(total('tickets'))} />
          <Stat label="ထိုးငွေ (အသားတင်)" value={`${money(total('net'))} Ks`} />
          <Stat label="ဆုငွေ" value={`${money(total('win'))} Ks`} color={GREEN} />
          <Stat label="အမြတ် / အရှုံး" value={`${signed(result)} Ks`} color={result >= 0 ? GREEN : RED} />
        </div>
        {shown.map((r) => <TermRow key={r.term_id} row={r} />)}
        <p className="m-foot-note">
          ပယ်ဖျက်ထားသော စလစ်များ မပါဝင်ပါ။ အမြတ်/အရှုံး = ဆုငွေ − ထိုးငွေ (ဆုငွေရှင်းပြီးသော အပါတ်စဥ်များ)။ ✓ ငွေရှင်းပြီး = Admin က သင်နှင့် ငွေစာရင်း ရှင်းပြီးကြောင်း မှတ်ထားသည်။
        </p>
      </div>
    );
  }

  return (
    <MScreen title="စာရင်းများကြည့်" actions={shown.length > 0 && <MIconButton label="ပို့ရန်" onClick={send}>📤</MIconButton>}>
      <div className="m-pad-x m-filters">
        <FolderTermFilter rows={rows ?? []} termNameKey="description" folderId={folderId} termId={termId}
          onChange={(f, t) => { setFolderId(f); setTermId(t); }} />
        <MSelect label="ငွေရှင်း" value={cleared} onChange={(v) => { setCleared(v); view(v); }}>
          <option value="">အားလုံး</option>
          <option value="1">ငွေရှင်းပြီးသော အပါတ်စဥ်များ</option>
          <option value="0">ငွေမရှင်းရသေးသော အပါတ်စဥ်များ</option>
        </MSelect>
        <button type="button" className="m-view-btn" disabled={loading} onClick={() => view()}>{loading ? '…' : '👁 View'}</button>
      </div>
      {body}
    </MScreen>
  );
}

const Stat = ({ label, value, color }) => (
  <div className="m-stat"><small>{label}</small><b style={{ color }}>{value}</b></div>
);

function TermRow({ row }) {
  const [label, color] = TERM_STATUS[row.status] ?? [row.status, '#64748b'];
  const settled = row.status === 'settled';
  const result = Number(row.result || 0);
  const cell = (l, v, c) => <span className="m-cell"><small>{l}</small><b style={{ color: c }}>{v}</b></span>;
  return (
    <div className="m-card">
      <div className="m-card-top">
        <GameCircle game={row.game} />
        <b>{row.description}</b>
        <StatusChip label={label} color={color} />
      </div>
      {row.cleared_at && <div style={{ marginTop: 6 }}><StatusChip label={`✓ ငွေရှင်းပြီး · ${dateTime(row.cleared_at)}`} color={GREEN} /></div>}
      <div className="m-cells">
        {cell('စလစ်', row.tickets)}
        {cell('ထိုးငွေ', money(row.net))}
        {cell('ဆုငွေ', Number(row.win) > 0 ? money(row.win) : '—', GREEN)}
        {cell('အမြတ်/အရှုံး', settled ? signed(result) : '—', settled ? (result >= 0 ? GREEN : RED) : undefined)}
      </div>
      {Number(row.discount) > 0 && <small className="m-muted-dark">စုစုပေါင်း {money(row.gross)} · ကော် {money(row.discount)}</small>}
    </div>
  );
}
