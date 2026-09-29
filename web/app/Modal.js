'use client';

import { useEffect, useId, useRef } from 'react';

/** Finestra sopra la pagina: si chiude con «Chiudi», con Esc o cliccando fuori. */
export default function Modal({ title, onClose, children, wide = false }) {
  const titleId = useId();
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: il clic sullo sfondo è una scorciatoia, Esc è gestito sul documento
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card" style={wide ? { width: 'min(960px, 100%)' } : undefined}>
        <div className="row">
          <h2 id={titleId}>{title}</h2>
          <span className="spacer" />
          <button type="button" className="small" onClick={onClose} ref={closeRef}>
            Chiudi
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
