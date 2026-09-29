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
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <Link href="/profili" className="back">
            ← Profili
          </Link>
          <h1>Profilo {id}</h1>
          <p>
            Il significato di ogni campo è spiegato nel README, sezione «Il profilo di ricerca». Prima di salvare il
            profilo viene controllato (comuni, zone, fonti).
          </p>
        </div>
        <Link href={`/?profile=${id}`} className="button">
          Vai alle offerte
        </Link>
      </header>
      <label htmlFor="profile-json" className="sr-only">
        Profilo in JSON
      </label>
      <textarea
        id="profile-json"
        className="code"
        rows={30}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="save-bar">
        {message && <span className={message.error ? 'error-box' : 'ok-box'}>{message.text}</span>}
        <button type="button" className="ghost" onClick={() => setText(initialText)} disabled={text === initialText}>
          Annulla modifiche
        </button>
        <button type="button" className="primary" onClick={save} disabled={saving || text === initialText}>
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
      </div>
    </div>
  );
}
