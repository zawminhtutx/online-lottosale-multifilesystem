import React from 'react';
import { useOnline } from './onlineContext.jsx';
import OnlineLoginForm from './OnlineLoginForm.jsx';

export default function OnlineLogin() {
  const { login } = useOnline();
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">🎲</div>
        <div className="login-title">Online Lotto System</div>
        <div className="login-sub">ကစားသူ အကောင့်ဖြင့် ဝင်ပါ</div>
        <OnlineLoginForm login={login} />
      </div>
    </div>
  );
}
