'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

/** Proposte dalle scelte sulle offerte: parole da escludere o da premiare. Applicarle salva il profilo. */
function LearnPanel({ id, dirty, onProfile }) {
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}/learn`);
    const data = await res.json();
    if (res.ok) setSuggestions(data.suggestions);
    else setError(data.error);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(s, action) {
    setError(null);
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestion: s.id, action }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setSuggestions(data.suggestions);
    if (action === 'apply') onProfile(data.profile);
  }

  if (!suggestions?.length && !error) return null;
  return (
    <section className="card stack learn" aria-labelledby="learn-title">
      <h2 id="learn-title">Dalle tue scelte</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Proposte ricavate dalle offerte che hai segnato «non mi interessa» e da quelle che segui. Decidi tu: «No,
        grazie» non la ripropone.
      </p>
      {error && <p className="error-box">{error}</p>}
      {dirty && (
        <p className="small warn-text">Salva o annulla le modifiche al profilo prima di applicare una proposta.</p>
      )}
      <ul className="learn-list">
        {suggestions?.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.title}</strong>
              <div className="small muted">{s.text}</div>
            </div>
            <div className="row">
              <button type="button" className="small primary" disabled={dirty} onClick={() => act(s, 'apply')}>
                {s.kind === 'exclude' ? 'Escludi' : 'Dai più punti'}
              </button>
              <button type="button" className="small ghost" onClick={() => act(s, 'dismiss')}>
                No, grazie
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ProfileEditor({ id, initialText: firstText }) {
  const [initialText, setInitialText] = useState(firstText);
  const [text, setText] = useState(firstText);
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
    if (res.ok) setInitialText(text);
  }

  const applied = (profile) => {
    const next = JSON.stringify(profile, null, 2);
    setInitialText(next);
    setText(next);
    setMessage({ text: 'Proposta applicata: profilo salvato.' });
  };

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
      <LearnPanel id={id} dirty={text !== initialText} onProfile={applied} />
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
