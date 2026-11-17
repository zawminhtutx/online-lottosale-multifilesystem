// Slip Printer Settings — same options as the POS Preferences page, stored per device. The
// installed-printer list and direct printing come from a local print server on this machine
// (localhost:3010, e.g. the POS server) when one runs; otherwise slips go through the browser's print dialog.
import React, { useEffect, useState } from 'react';
import { Modal, useToast } from './components/ui.jsx';
import {
  defaultCompanyName, getOwnCompanyName, getSlipBranding, getSlipLayout, getSlipPrinterName, getSlipPrinterSuggestions, getSlipWidth,
  printServerApi, setSlipBranding, setSlipLayout, setSlipPrinterName, setSlipWidth,
} from './print/settings.js';
import { printOnlineSlip } from './onlinePrint.js';

const SLIP_WIDTHS = [
  { value: '58mm', label: '58mm', desc: 'Thermal (small)' },
  { value: '80mm', label: '80mm', desc: 'Thermal (standard)' },
];
const FONT_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
];

const SAMPLE = {
  ticket: {
    slip_no: '0000001',
    created_at: new Date().toISOString(),
    items: [
      { number: '45', units: 3 }, { number: '54', units: 3 }, { number: '12', units: 5 }, { number: '385', units: 1 },
    ],
  },
  term: { id: 0, description: 'Test Print', unit_price: 100 },
  user: { username: 'TEST' },
  lines: [
    { input: '45R', numbers: ['45', '54'], unit: 3 },
    { input: '12', numbers: ['12'], unit: 5 },
    { input: '385', numbers: ['385'], unit: 1 },
  ],
};

export default function SlipPrinterSettings({ onClose }) {
  const toast = useToast();
  const [printers, setPrinters] = useState(null); // null = loading, [] = no print server reachable
  const [printerName, setPrinterNameState] = useState(getSlipPrinterName());
  const [width, setWidthState] = useState(getSlipWidth());
  const [layout, setLayoutState] = useState(getSlipLayout());
  const [branding, setBrandingState] = useState(getSlipBranding());
  const [testing, setTesting] = useState(false);

  function loadPrinters() {
    setPrinters(null);
    printServerApi('/system-printers')
      .then((list) => {
        const names = Array.isArray(list) ? list : [];
        setPrinters(names);
      })
      .catch(() => setPrinters([]));
  }
  useEffect(loadPrinters, []);

  const choosePrinter = (name) => { setPrinterNameState(name); setSlipPrinterName(name); };
  const chooseWidth = (w) => { setWidthState(w); setSlipWidth(w); };
  const updateLayout = (patch) => setLayoutState(setSlipLayout(patch));
  const updateBranding = (patch) => { setBrandingState(setSlipBranding(patch)); setLayoutState(getSlipLayout()); };

  async function testPrint() {
    setTesting(true);
    try {
      const how = await printOnlineSlip({ ...SAMPLE, copy: 1 });
      toast(how === 'direct' ? `🖨️ Test Print ကို ${printerName} သို့ ပို့ပြီးပါပြီ` : '🖨️ Print dialog ဖွင့်ပြီးပါပြီ', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTesting(false);
    }
  }

  // Printers found on this machine first, then names chosen before (kept even when not found now).
  const printerOptions = [...new Set([...(printers ?? []), printerName, ...getSlipPrinterSuggestions()].filter(Boolean))];
  const row = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 };

  return (
    <Modal
      title="🧾 Slip Printer Settings"
      wide
      onClose={onClose}
      footer={(
        <>
          <button className="btn secondary" disabled={testing} onClick={testPrint}>{testing ? 'ပို့နေသည်...' : '🖨️ Test Print'}</button>
          <button className="btn" onClick={onClose}>Close</button>
        </>
      )}
    >
      <div className="sale-field">
        <label>Slip Printer</label>
        {/* Always a select box: printers found on this machine, plus names chosen before. */}
        <select className="input" value={printerName} onChange={(e) => choosePrinter(e.target.value)}>
          <option value="">🌐 Browser Print Dialog</option>
          {printerOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <small className="ol-muted">Slip Printer ရွေးပါ</small>
      </div>

      <div className="sale-field">
        <label>Print Width</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {SLIP_WIDTHS.map((s) => (
            <button
              key={s.value}
              className={`btn ${width === s.value ? '' : 'secondary'}`}
              style={{ flex: '1 1 140px', flexDirection: 'column', alignItems: 'flex-start', padding: '10px 14px', gap: 2 }}
              onClick={() => chooseWidth(s.value)}
            >
              <span style={{ fontWeight: 700 }}>{s.label}</span>
              <span style={{ fontSize: 11.5, fontWeight: 400, opacity: 0.85 }}>{s.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sale-field">
        <label>Font Size</label>
        <div style={{ display: 'flex', gap: 10 }}>
          {FONT_SIZES.map((f) => (
            <button key={f.value} className={`btn sm ${layout.fontSize === f.value ? '' : 'secondary'}`} style={{ flex: 1 }} onClick={() => updateLayout({ fontSize: f.value })}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sale-field">
        <label>Layout</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className={`btn sm ${layout.columns === 'two' ? '' : 'secondary'}`} style={{ flex: 1 }} onClick={() => updateLayout({ columns: 'two' })}>Two Column</button>
          <button className={`btn sm ${layout.columns === 'single' ? '' : 'secondary'}`} style={{ flex: 1 }} onClick={() => updateLayout({ columns: 'single' })}>Single Column</button>
        </div>
      </div>

      <div style={row}>
        <div className="sale-field" style={{ marginBottom: 0 }}>
          <label>Left Align Margin (mm)</label>
          <input className="input" type="number" step="0.1" min="0" defaultValue={layout.marginMm} onBlur={(e) => updateLayout({ marginMm: Number(e.target.value) || 0 })} />
        </div>
        <div className="sale-field" style={{ marginBottom: 0 }}>
          <label>Digit Item Extra Margin (mm)</label>
          <input className="input" type="number" step="0.1" min="0" defaultValue={layout.itemsExtraMarginMm} onBlur={(e) => updateLayout({ itemsExtraMarginMm: Number(e.target.value) || 0 })} />
        </div>
      </div>

      <div style={row}>
        {[
          ['bold', 'Bold Print'],
          ['groupPrint', 'Group Print'],
          ['showAmount', 'Amount line'],
          ['showTotal', 'Total line'],
        ].map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!layout[key]} onChange={(e) => updateLayout({ [key]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div style={row}>
        <div className="sale-field" style={{ marginBottom: 0 }}>
          <label>Company Name</label>
          {/* Left empty: the company name the admin set (shown as the placeholder). */}
          <input className="input" defaultValue={getOwnCompanyName()} placeholder={defaultCompanyName()} onBlur={(e) => updateBranding({ companyName: e.target.value.trim() })} />
        </div>
        <div className="sale-field" style={{ marginBottom: 0 }}>
          <label>Footer Text</label>
          <input className="input" defaultValue={branding.footerText} onBlur={(e) => updateBranding({ footerText: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
