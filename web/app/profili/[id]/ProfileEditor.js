'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ProfileEditor({ id, initialText }) {
  const [text, setText] = useState(initialText);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setMessage(null);
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      return setMessage({ error: true, text: `JSON non valido: ${err.message}` });
    }
    setSaving(true);
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    const body = await res.json();
    setSaving(false);
    setMessage(res.ok ? { text: 'Profilo salvato.' } : { error: true, text: body.error });
  }

  return (
    <div className="stack">
      <div className="row">
        <h1>Profilo {id}</h1>
        <span className="spacer" />
        <Link href={`/?profile=${id}`}>Vai alle offerte</Link>
      </div>
      <p className="muted small">
        Il significato di ogni campo è spiegato nel README, sezione «Il profilo di ricerca». Prima di salvare il profilo
        viene controllato (comuni, target, fonti).
      </p>
      <textarea rows={30} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button type="button" onClick={save} disabled={saving || text === initialText}>
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setText(initialText)}
          disabled={text === initialText}
        >
          Annulla modifiche
        </button>
        {message && <span className={message.error ? 'error-box' : 'ok-box'}>{message.text}</span>}
      </div>
    </div>
  );
}
