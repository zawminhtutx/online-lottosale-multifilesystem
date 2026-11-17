// Phone sign-in: the same fields as the desktop login, on the indigo look.
import React from 'react';
import { useOnline } from '../onlineContext.jsx';
import OnlineLoginForm from '../OnlineLoginForm.jsx';
import './mobile.css';

export default function MobileLogin() {
  const { login } = useOnline();
  return (
    <div className="m-screen m-login">
      <div className="m-login-head">
        <div className="m-login-logo">🎲</div>
        <div className="m-brand">Online Lotto</div>
        <div className="m-brand-sub">ကစားသူ အကောင့်ဖြင့် ဝင်ပါ</div>
      </div>
      <div className="m-login-card">
        <OnlineLoginForm login={login} />
      </div>
    </div>
  );
}
