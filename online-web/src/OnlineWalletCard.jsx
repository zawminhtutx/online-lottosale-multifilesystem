// 💰 Wallet on the profile page: the balance, the KPay / WavePay numbers of the account above (its
// agent, master or admin — middle hidden, Copy copies the whole number), ငွေဖြည့် / ငွေထုတ် requests to it
// (the agent approves them — the money moves only then), the requests sent so far (a pending one
// can be cancelled) and the wallet history.
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, useToast } from './components/ui.jsx';
import { useOnline } from './onlineContext.jsx';
import { onlineApi } from './onlineApi.js';
import { WALLET_TYPE, dateTime, maskNumber, money } from './format.js';

const METHODS = ['KPay', 'WavePay', 'AYA Pay', 'CB Pay', 'Cash', 'Other'];
const STATUS = {
  pending: ['စောင့်ဆိုင်းဆဲ', 'orange'],
  approved: ['အတည်ပြုပြီး', 'green'],
  rejected: ['ငြင်းပယ်ပြီး', 'red'],
  cancelled: ['ပယ်ဖျက်ပြီး', 'gray'],
};

export default function OnlineWalletCard() {
  const { user, refreshMe } = useOnline();
  const toast = useToast();
  const [tab, setTab] = useState('requests'); // requests | history
  const [requests, setRequests] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(null); // 'deposit' | 'withdraw' while the form is open
  const [payTo, setPayTo] = useState(null);
  useEffect(() => { onlineApi('/wallet-requests/pay-to').then(setPayTo).catch(() => {}); }, []);

  const load = useCallback(() => {
    setError('');
    Promise.all([onlineApi('/wallet-requests?limit=100'), onlineApi('/wallet/transactions?limit=100')])
      .then(([r, w]) => { setRequests(r); setHistory(w); })
      .catch((err) => setError(err.message));
    refreshMe().catch(() => {});
  }, [refreshMe]);
  useEffect(() => { load(); }, [load]);

  async function cancel(r) {
    if (!window.confirm('ဤတောင်းဆိုမှုကို ပယ်ဖျက်မလား?')) return;
    try {
      await onlineApi(`/wallet-requests/${r.id}/cancel`, { method: 'POST' });
      toast('ပယ်ဖျက်ပြီးပါပြီ', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <section className="card ol-card ol-wallet">
      <div className="ol-card-head">
        <h3 style={{ margin: 0 }}>💰 Wallet</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ background: '#059669', color: '#fff' }} onClick={() => setAsking('deposit')}>➕ ငွေဖြည့်</button>
          <button className="btn" style={{ background: '#ea580c', color: '#fff' }} onClick={() => setAsking('withdraw')}>➖ ငွေထုတ်</button>
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, marginBottom: 4 }}>
        <span className={user.balance < 0 ? 'ol-neg' : ''}>{money(user.balance)}</span> ကျပ်
        {!!user.unlimited && <span className="badge purple" style={{ marginLeft: 8, fontSize: 13 }}>∞ အကန့်အသတ်မဲ့</span>}
      </div>
      {payTo && <PayTo payTo={payTo} />}
      <p className="ol-muted" style={{ margin: '0 0 12px' }}>ငွေဖြည့် / ငွေထုတ် တောင်းဆိုပြီး သင့်အေးဂျင့် အတည်ပြုမှ လက်ကျန်ငွေ ပြောင်းပါမည်။</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button className={`btn ${tab === 'requests' ? '' : 'secondary'}`} onClick={() => setTab('requests')}>ငွေဖြည့်/ထုတ် တောင်းဆိုမှု</button>
        <button className={`btn ${tab === 'history' ? '' : 'secondary'}`} onClick={() => setTab('history')}>ငွေစာရင်း</button>
      </div>

      {error && <div className="ol-error">{error}</div>}
      {!error && tab === 'requests' && <Requests rows={requests} onCancel={cancel} />}
      {!error && tab === 'history' && <History rows={history} />}

      {asking && (
        <RequestForm
          type={asking}
          balance={user.balance}
          onClose={() => setAsking(null)}
          onSent={() => {
            toast(asking === 'deposit' ? 'ငွေဖြည့် တောင်းဆိုပြီးပါပြီ — အေးဂျင့် အတည်ပြုရန် စောင့်ပါ' : 'ငွေထုတ် တောင်းဆိုပြီးပါပြီ — အေးဂျင့် အတည်ပြုရန် စောင့်ပါ', 'success');
            setAsking(null);
            setTab('requests');
            load();
          }}
        />
      )}
    </section>
  );
}

// Where to send money: each number with its middle hidden and a Copy button for the whole number.
// onPick (deposit form): also selects that method.
function PayTo({ payTo, onPick }) {
  const toast = useToast();
  const copy = (number, method) => {
    const full = String(number).trim();
    (navigator.clipboard?.writeText(full) ?? Promise.reject())
      .then(() => toast(`${method} နံပါတ် Copy ကူးပြီးပါပြီ`, 'success'))
      .catch(() => toast('Copy မရပါ', 'error'));
    onPick?.(method);
  };
  const row = (method, number, name) => number && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <b style={{ width: 70 }}>{method}</b>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 1 }}>{maskNumber(number)}</div>
        {name && <div className="ol-muted">{name}</div>}
      </div>
      <button type="button" className="btn secondary sm" onClick={() => copy(number, method)}>📋 Copy</button>
    </div>
  );
  return (
    <div className="card" style={{ padding: '10px 14px', margin: '8px 0 12px', background: '#ecfdf5' }}>
      <div className="ol-muted">ငွေလွှဲရန် နံပါတ် · {payTo.username}</div>
      {row('KPay', payTo.kpay_no, payTo.kpay_name)}
      {row('WavePay', payTo.wave_no, payTo.wave_name)}
    </div>
  );
}

function Requests({ rows, onCancel }) {
  if (!rows) return <div className="center-note">Loading...</div>;
  if (!rows.length) return <div className="ol-empty">တောင်းဆိုမှု မရှိသေးပါ</div>;
  return (
    <div className="table-wrap">
      <table className="ol-table">
        <thead><tr><th>အချိန်</th><th>အမျိုးအစား</th><th className="num">ပမာဏ</th><th>နည်းလမ်း</th><th>အခြေအနေ</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const [label, tone] = STATUS[r.status] ?? [r.status, 'gray'];
            return (
              <tr key={r.id}>
                <td>{dateTime(r.created_at)}</td>
                <td className={r.type === 'deposit' ? 'ol-pos' : 'ol-neg'}>{r.type === 'deposit' ? 'ငွေဖြည့်' : 'ငွေထုတ်'}</td>
                <td className="num"><b>{money(r.amount)}</b></td>
                <td>{r.method}{r.txn_ref ? <div className="ol-muted">No. {r.txn_ref}</div> : null}</td>
                <td>
                  <span className={`badge ${tone}`}>{label}</span>
                  {r.reject_reason && <div className="ol-muted">{r.reject_reason}</div>}
                </td>
                <td>{r.status === 'pending' && <button className="btn secondary sm" onClick={() => onCancel(r)}>ပယ်ဖျက်</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function History({ rows }) {
  if (!rows) return <div className="center-note">Loading...</div>;
  if (!rows.length) return <div className="ol-empty">ငွေစာရင်း မရှိသေးပါ</div>;
  return (
    <div className="table-wrap">
      <table className="ol-table">
        <thead><tr><th>အချိန်</th><th>အမျိုးအစား</th><th className="num">ပမာဏ</th><th className="num">လက်ကျန်</th></tr></thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td>{dateTime(w.created_at)}</td>
              <td>{WALLET_TYPE[w.type] ?? w.type}{w.note ? <div className="ol-muted">{w.note}</div> : null}</td>
              <td className={`num ${w.amount < 0 ? 'ol-neg' : 'ol-pos'}`}>{w.amount > 0 ? '+' : ''}{money(w.amount)}</td>
              <td className={`num ${w.balance_after < 0 ? 'ol-neg' : ''}`}>{money(w.balance_after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ငွေဖြည့် shows where to send the money (the agent's KPay / WavePay); ငွေထုတ် needs the account
// to receive it.
function RequestForm({ type, balance, onClose, onSent }) {
  const deposit = type === 'deposit';
  const [payTo, setPayTo] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'KPay', account_name: '', account_no: '', txn_ref: '', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (deposit) onlineApi('/wallet-requests/pay-to').then(setPayTo).catch(() => {});
  }, [deposit]);

  async function submit() {
    setError('');
    const amount = Number(String(form.amount).replace(/,/g, ''));
    if (!Number.isInteger(amount) || amount <= 0) return setError('ပမာဏ ထည့်ပါ');
    if (!deposit && !form.account_no.trim()) return setError('ငွေလက်ခံမည့် ဖုန်း/အကောင့်နံပါတ် ထည့်ပါ');
    if (!deposit && amount > balance) return setError('လက်ကျန်ငွေ မလောက်ပါ');
    const body = { type, amount, method: form.method };
    for (const k of ['account_name', 'account_no', 'txn_ref', 'note']) if (form[k].trim()) body[k] = form[k].trim();
    setBusy(true);
    try {
      await onlineApi('/wallet-requests', { method: 'POST', body });
      onSent();
    } catch (err) {
      setError(err.message === 'Insufficient balance' ? 'လက်ကျန်ငွေ မလောက်ပါ (စောင့်ဆိုင်းဆဲ ငွေထုတ်များ ပါဝင်)' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = (k, label, props = {}) => (
    <div className="form-group">
      <label className="field-label" htmlFor={`wr-${k}`}>{label}</label>
      <input id={`wr-${k}`} className="input" value={form[k]} onChange={set(k)} {...props} />
    </div>
  );

  return (
    <Modal
      title={deposit ? '➕ ငွေဖြည့် တောင်းဆိုရန်' : '➖ ငွေထုတ် တောင်းဆိုရန်'}
      onClose={onClose}
      onConfirm={submit}
      footer={(
        <>
          <button className="btn secondary" onClick={onClose}>မလုပ်တော့ပါ</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'ပို့နေသည်...' : 'တောင်းဆိုမည်'}</button>
        </>
      )}
    >
      {deposit && payTo && <PayTo payTo={payTo} onPick={(method) => setForm((f) => ({ ...f, method }))} />}
      {field('amount', 'ပမာဏ (ကျပ်)', { inputMode: 'numeric', autoFocus: true })}
      <div className="form-group">
        <label className="field-label" htmlFor="wr-method">ငွေလွှဲနည်း</label>
        <select id="wr-method" className="input" value={form.method} onChange={set('method')}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {deposit && field('txn_ref', 'ငွေလွှဲ No. (Transaction)')}
      {field('account_name', deposit ? 'ပေးပို့သူ အမည်' : 'လက်ခံမည့် အကောင့်အမည်')}
      {field('account_no', deposit ? 'ပေးပို့သူ ဖုန်း/အကောင့်' : 'လက်ခံမည့် ဖုန်း/အကောင့် (မဖြစ်မနေ)', { inputMode: 'tel' })}
      {field('note', 'မှတ်ချက် (မဖြည့်လည်းရ)')}
      {error && <div className="login-error" role="alert">{error}</div>}
    </Modal>
  );
}
