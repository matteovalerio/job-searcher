'use client';

import { useEffect, useState } from 'react';
import { relativeDay, scoreTier } from '../lib/format.js';

/** Riga di un'offerta con i controlli per seguirla (stato e nota). */
export default function JobCard({ job, statuses, onTracked, onKit }) {
  const [status, setStatus] = useState(job.tracking?.status ?? '');
  const [note, setNote] = useState(job.tracking?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Lo stato può cambiare anche dal kit di candidatura.
  useEffect(() => setStatus(job.tracking?.status ?? ''), [job.tracking?.status]);

  async function save(next) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job, status: next.status || undefined, note: next.note }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      onTracked?.(job.id, body);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Torna "non toccata": la candidatura si toglie (il kit, se c'è, resta).
  async function untrack() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/tracking?id=${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error((await res.json()).error);
      setNote('');
      onTracked?.(job.id, null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const tags = [...(job.tags ?? []), ...(job.infoText ? job.infoText.split(' · ') : [])];
  return (
    <article className="job">
      <div className={`score ${scoreTier(job.score ?? 0)}`} title={`Punteggio: ${job.score ?? 0}`}>
        {job.score ?? 0}
      </div>
      <div className="main">
        <div className="title">
          <a href={job.url} target="_blank" rel="noopener noreferrer">
            {job.title}
          </a>
          {job.isNew && <span className="badge">Nuova</span>}
          {job.warnings.map((w) => (
            <span key={w} className="badge warn">
              {w}
            </span>
          ))}
        </div>
        <div className="meta">{[job.company, job.location].filter(Boolean).join(' · ')}</div>
        {tags.length > 0 && (
          <div className="tags">
            {tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
        {job.description && (
          <details>
            <summary>Descrizione</summary>
            <p>{job.description}</p>
          </details>
        )}
      </div>
      <div className="when">
        <span>{relativeDay(job.postedAt) ?? 'data sconosciuta'}</span>
        <span className="faint">
          {job.source} ·{' '}
          <code title="Codice per la riga di comando: job-searcher track <codice> <stato>">{job.shortId}</code>
        </span>
      </div>
      <div className="track">
        <select
          aria-label={`Stato di "${job.title}"`}
          value={status}
          disabled={saving}
          onChange={(e) => {
            setStatus(e.target.value);
            if (e.target.value) save({ status: e.target.value, note });
            else untrack();
          }}
        >
          <option value="">{status ? 'Non seguire più' : 'Segui…'}</option>
          {Object.entries(statuses).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {status && (
          <input
            type="text"
            aria-label={`Nota su "${job.title}"`}
            placeholder="Nota (es. CV inviato il…)"
            value={note}
            disabled={saving}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            onBlur={() => note !== (job.tracking?.note ?? '') && save({ status, note })}
          />
        )}
        {onKit && (
          <button type="button" className="small ghost" onClick={onKit}>
            Kit candidatura
          </button>
        )}
        {error && <span className="error-box small">{error}</span>}
      </div>
    </article>
  );
}
