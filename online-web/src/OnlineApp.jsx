// Online 2D/3D web app for OnlineLotto users. Same shell as the POS app's Layout: topbar with
// page title / Exit / Logout, then the page (sale page fitted to the viewport).
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { OnlineProvider, useOnline } from './onlineContext.jsx';
import { money } from './format.js';
import OnlineLogin from './OnlineLogin.jsx';
import OnlineMenu from './OnlineMenu.jsx';
import OnlineTermsPage from './OnlineTermsPage.jsx';
import OnlineSalePage from './OnlineSalePage.jsx';
import OnlineSlipsPage from './OnlineSlipsPage.jsx';
import OnlineProfilePage from './OnlineProfilePage.jsx';
import OnlineResultsPage from './OnlineResultsPage.jsx';
import OnlineReportsPage from './OnlineReportsPage.jsx';
import MobileSalePage from './mobile/MobileSalePage.jsx';
import MobileHome from './mobile/MobileHome.jsx';
import MobileTerms from './mobile/MobileTerms.jsx';
import MobileSlips from './mobile/MobileSlips.jsx';
import MobileReports from './mobile/MobileReports.jsx';
import MobileResults from './mobile/MobileResults.jsx';
import MobileProfile from './mobile/MobileProfile.jsx';
import MobileLogin from './mobile/MobileLogin.jsx';
import { useMobile } from './mobile/useMobile.js';
import './online.css';

const TITLES = [
  [/^\/$/, 'Dashboard'],
  [/^\/terms/, 'အရောင်း — အပါတ်စဥ် ရွေးရန်'],
  [/^\/sale\//, 'အရောင်း'],
  [/^\/slips/, 'စလစ်များ'],
  [/^\/profile/, 'ကိုယ်ရေးအချက်အလက်'],
  [/^\/results/, 'ပေါက်ဂဏန်း'],
  [/^\/reports/, 'စာရင်းများ'],
];

function OnlineLayout({ children }) {
  const { user, logout, guardedNavigate, openPrinterSettings } = useOnline();
  const { pathname } = useLocation();
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Online';
  const isMenu = pathname === '/';
  const fit = pathname.startsWith('/sale/');

  return (
    <div className="shell">
      <main className="main">
        <header className="topbar ol-topbar">
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>🎲</span>
            <b>{title}</b>
            <span className="badge green">🌐 Online</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!isMenu && (
              <button type="button" className="btn danger sm" onClick={() => guardedNavigate('/')}>🚪 Exit</button>
            )}
            <span className="chip ol-balance-chip" title="လက်ကျန်ငွေ">
              💰 <span className={user.balance < 0 ? 'ol-neg' : ''}>{money(user.balance)}</span> ကျပ်{user.unlimited ? ' · ∞' : ''}
            </span>
            <button type="button" className="btn secondary sm" onClick={openPrinterSettings}>🖨️ Printer</button>
            <button type="button" className="btn secondary sm" onClick={logout}>🚪 Logout</button>
            <button type="button" className="chip ol-user-chip" title="ကိုယ်ရေးအချက်အလက်" onClick={() => guardedNavigate('/profile')}>👤 {user.name}</button>
          </span>
        </header>
        <div className={`content ${fit ? 'content-fit' : ''}`}>{children}</div>
      </main>
    </div>
  );
}

// bare: the page draws its own full-screen phone layout (no desktop topbar).
function RequireOnlineUser({ children, bare }) {
  const { user, ready } = useOnline();
  if (!ready) return <div className="center-note">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return bare ? children : <OnlineLayout>{children}</OnlineLayout>;
}

// Phones and the mini app (?embed=1) get the online-mobile app's screens (full-screen, their own
// app bar); a desktop browser gets the POS-style pages inside the topbar layout.
function Page({ desktop, phone }) {
  const mobile = useMobile();
  return mobile ? <RequireOnlineUser bare>{phone}</RequireOnlineUser> : <RequireOnlineUser>{desktop}</RequireOnlineUser>;
}

function LoginRoute() {
  const { user, ready } = useOnline();
  const mobile = useMobile();
  if (ready && user) return <Navigate to="/" replace />;
  return mobile ? <MobileLogin /> : <OnlineLogin />;
}

export default function OnlineApp() {
  return (
    <OnlineProvider>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/" element={<Page desktop={<OnlineMenu />} phone={<MobileHome />} />} />
        <Route path="/terms" element={<Page desktop={<OnlineTermsPage />} phone={<MobileTerms />} />} />
        <Route path="/sale/:termId" element={<Page desktop={<OnlineSalePage />} phone={<MobileSalePage />} />} />
        <Route path="/slips" element={<Page desktop={<OnlineSlipsPage />} phone={<MobileSlips />} />} />
        <Route path="/profile" element={<Page desktop={<OnlineProfilePage />} phone={<MobileProfile />} />} />
        <Route path="/results" element={<Page desktop={<OnlineResultsPage />} phone={<MobileResults />} />} />
        <Route path="/reports" element={<Page desktop={<OnlineReportsPage />} phone={<MobileReports />} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </OnlineProvider>
  );
}
