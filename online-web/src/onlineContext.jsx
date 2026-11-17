// Online user session: who is signed in to OnlineLotto (with their current balance), plus the
// "unsaved slip" guard the Sale page uses — same idea as the POS app's unsavedSaleData.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './components/ui.jsx';
import { clearOnlineSession, getOnlineToken, getOnlineUser, onlineApi, onlineLogin, setOnlineSession } from './onlineApi.js';
import SlipPrinterSettings from './SlipPrinterSettings.jsx';
import { setServerCompanyName } from './print/settings.js';

// The company name heading slips (set by the admin); loaded once signed in.
const loadCompany = () => onlineApi('/settings/company').then((r) => setServerCompanyName(r.company_name)).catch(() => {});

const OnlineContext = createContext(null);
export const useOnline = () => useContext(OnlineContext);

export function OnlineProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(getOnlineUser());
  const [ready, setReady] = useState(!getOnlineToken());
  const [unsaved, setUnsaved] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState(null); // path waiting on the "leave?" confirm
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const openPrinterSettings = useCallback(() => setPrinterSettingsOpen(true), []);

  const refreshMe = useCallback(async () => {
    const me = await onlineApi('/auth/me');
    setOnlineSession(getOnlineToken(), me);
    setUser(me);
    loadCompany();
    return me;
  }, []);

  useEffect(() => {
    if (getOnlineToken()) refreshMe().catch(() => setUser(null)).finally(() => setReady(true));
    const onLogout = () => setUser(null);
    window.addEventListener('online-logout', onLogout);
    return () => window.removeEventListener('online-logout', onLogout);
  }, [refreshMe]);

  const login = useCallback(async (username, password, rememberMe) => {
    const u = await onlineLogin(username, password, rememberMe);
    setUser(u);
    loadCompany();
    return u;
  }, []);

  const logout = useCallback(() => {
    clearOnlineSession();
    setUnsaved(false);
    setUser(null);
  }, []);

  // Navigation that asks first while the Sale page holds lines not yet saved.
  const guardedNavigate = useCallback((to) => {
    if (unsaved) setLeaveTarget(to);
    else navigate(to);
  }, [unsaved, navigate]);

  const confirmLeave = () => {
    const to = leaveTarget;
    setLeaveTarget(null);
    setUnsaved(false);
    navigate(to);
  };

  return (
    <OnlineContext.Provider value={{ user, ready, login, logout, refreshMe, unsaved, setUnsaved, guardedNavigate, openPrinterSettings }}>
      {children}
      {printerSettingsOpen && <SlipPrinterSettings onClose={() => setPrinterSettingsOpen(false)} />}
      {leaveTarget && (
        <Modal
          title="⚠️ မသိမ်းရသေးပါ"
          onClose={() => setLeaveTarget(null)}
          footer={(
            <>
              <button className="btn" onClick={() => setLeaveTarget(null)}>✅ ဆက်ရောင်းမည်</button>
              <button className="btn danger" onClick={confirmLeave}>🗑️ မသိမ်းဘဲ ထွက်မည်</button>
            </>
          )}
        >
          <p style={{ margin: 0 }}>ရိုက်ထားသော ဂဏန်းများ မသိမ်းရသေးပါ။ မသိမ်းဘဲ ထွက်မှာ သေချာပါသလား?</p>
        </Modal>
      )}
    </OnlineContext.Provider>
  );
}
