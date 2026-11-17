// OnlineLotto user sign-in fields. `login(username, password, rememberMe)` does the sign-in (and
// throws on failure). "Remember me" keeps the session after the browser closes and fills in the
// username next time.
import React, { useRef, useState } from 'react';
import { getRememberedUsername } from './onlineApi.js';

export default function OnlineLoginForm({ login }) {
  const passwordRef = useRef(null);
  const [username, setUsername] = useState(getRememberedUsername);
  const [rememberMe, setRememberMe] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password, rememberMe);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="field-label" htmlFor="ol-username">အသုံးပြုသူအမည်</label>
        <input
          id="ol-username"
          className="input"
          autoComplete="username"
          autoFocus={!username}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              passwordRef.current?.focus();
            }
          }}
        />
      </div>
      <div className="form-group">
        <label className="field-label" htmlFor="ol-password">စကားဝှက်</label>
        <input
          id="ol-password"
          ref={passwordRef}
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          autoFocus={!!username}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <label className="remember-me">
        <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
        <span>Remember me (မှတ်ထားမည်)</span>
      </label>
      <button className="btn block" type="submit" disabled={busy || !username || !password}>
        {busy ? 'ဝင်နေသည်...' : 'Online ဝင်မည်'}
      </button>
      <div className="login-hint">အကောင့်မရှိသေးလျှင် သင့်အေးဂျင့်ကို ဆက်သွယ်ပါ</div>
    </form>
  );
}
