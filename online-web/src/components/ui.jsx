import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Windows-app-style keyboard shortcuts every Modal now gets for free: Esc always maps to onClose
// (every existing caller already treats that as "Cancel/No"), and Enter maps to the optional
// onConfirm a caller can pass for its own "Yes/OK/Save" action — opt-in rather than guessing which
// button in an arbitrary footer is the "primary" one. Skipped while focus is in a <textarea> (a
// multi-line field where Enter means "new line", not "submit the dialog") or on a <button> (which
// already has its own native Enter-activates-me behavior — re-triggering onConfirm on top of that
// would double-fire whichever button has focus).
export function Modal({ title, onClose, onConfirm, children, footer, wide, className }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        onClose && onClose();
      } else if (e.key === 'Enter') {
        const tag = e.target.tagName;
        if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
        if (onConfirm) {
          e.preventDefault();
          onConfirm();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, onConfirm]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className || ''}`.trim()}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          {onClose && <button className="modal-close" onClick={onClose}>×</button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
