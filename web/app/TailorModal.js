'use client';

import { useCallback, useEffect, useState } from 'react';
import { CopyIcon, ExternalIcon } from './icons.js';
import Modal from './Modal.js';

/**
 * CV su misura per un'offerta ({ job: id }) o una casa editrice ({ publisher: id }): cosa valorizzare e
 * testo da incollare su claude.ai (o in un altro assistente).
 */
export default function TailorModal({ target, onClose }) {
  const [state, setState] = useState({ loading: true });
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/tailor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    });
    const data = await res.json();
    setState(res.ok ? data : { error: data.error });
  }, [target]);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadCv(file) {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('cv', file);
    const res = await fetch('/api/cv', { method: 'POST', body: form });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) return setState((s) => ({ ...s, cvError: data.error }));
    load();
  }

  async function copy() {
    await navigator.clipboard.writeText(state.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const e = state.emphasis;
  return (
    <Modal title={state.title ? `CV su misura — ${state.title}` : 'CV su misura'} onClose={onClose} wide>
      {state.loading && <p className="muted">Preparo le indicazioni…</p>}
      {state.error && <div className="error-box">{state.error}</div>}
      {e && (
        <>
          <p className="small muted">
            {e.specialties.length
              ? `Specializzazione riconosciuta: ${e.specialties.map((s) => s.label).join(', ')}.`
              : "Specializzazione non riconosciuta: Claude la dedurrà dal sito o dall'annuncio."}{' '}
            Il testo chiede a Claude di riscrivere il CV seguendo queste indicazioni, senza inventare nulla.
          </p>
          <div className="grid-2 even">
            <div className="stack" style={{ gap: 8 }}>
              <span className="overline">Da valorizzare</span>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                {e.focus.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="overline">In secondo piano</span>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                {e.downplay.length ? e.downplay.map((d) => <li key={d}>{d}</li>) : <li>niente in particolare</li>}
              </ul>
            </div>
          </div>
          {!state.hasCv && (
            <label className="check">
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={uploading}
                onChange={(ev) => uploadCv(ev.target.files[0])}
                style={{ width: 'auto' }}
              />
              <span>
                <strong>{uploading ? 'Lettura del CV…' : 'Nessun CV salvato'}</strong>
                <span className="muted small">
                  Caricalo qui per includerlo nel testo (resta sul tuo computer), oppure allegalo nella chat.
                </span>
                {state.cvError && <span className="error-box small">{state.cvError}</span>}
              </span>
            </label>
          )}
          <textarea className="code" readOnly rows={12} value={state.prompt} aria-label="Testo per Claude" />
          <div className="row">
            <button type="button" className="primary" onClick={copy}>
              <CopyIcon />
              {copied ? 'Copiato' : 'Copia'}
            </button>
            <a className="button" href="https://claude.ai/new" target="_blank" rel="noreferrer">
              Apri claude.ai <ExternalIcon />
            </a>
            <span className="faint small">Funziona anche con altri assistenti: è testo normale.</span>
          </div>
        </>
      )}
    </Modal>
  );
}
