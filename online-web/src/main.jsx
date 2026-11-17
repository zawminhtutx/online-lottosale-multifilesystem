import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import OnlineApp from './OnlineApp.jsx';
import { ToastProvider } from './components/ui.jsx';
import { getTheme, applyTheme } from './theme.js';
import { initButtonSounds } from './sound.js';
import { isEmbedded } from './mobile/useMobile.js';
// Poppins (latin only, bundled — no external font request) for the sale page's slip table.
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './styles.css';

isEmbedded(); // remembers ?embed=1 (mini app) for the tab before any navigation drops the query
applyTheme(getTheme());
initButtonSounds();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <OnlineApp />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
