'use client';

import { useState } from 'react';

/** Scheda di un'offerta con i controlli per seguirla (stato e nota). */
export default function JobCard({ job, statuses, onTracked }) {
  const [status, setStatus] = useState(job.tracking?.status ?? '');
  const [note, setNote] = useState(job.tracking?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  const date = job.postedAt ? new Date(job.postedAt).toLocaleDateString('it-IT') : null;
  return (
    <article className="card job">
      <h3>
        <a href={job.url} target="_blank" rel="noopener noreferrer">
          {job.title}
        </a>
        {job.isNew && <span className="badge new">nuova</span>}
        {job.tracking && <span className="badge status">{job.tracking.label}</span>}
        {job.warnings.map((w) => (
          <span key={w} className="badge warn">
            {w}
          </span>
        ))}
      </h3>
      <p className="meta">{[job.company, job.location, date, job.source].filter(Boolean).join(' · ')}</p>
      {job.infoText && <p className="info">{job.infoText}</p>}
      {job.description && (
        <details>
          <summary>Descrizione</summary>
          <p>{job.description}</p>
        </details>
      )}
      <div className="row track">
        <select
          aria-label="Stato"
          value={status}
          disabled={saving}
          onChange={(e) => {
            setStatus(e.target.value);
            if (e.target.value) save({ status: e.target.value, note });
          }}
        >
          <option value="">Segui…</option>
          {Object.entries(statuses).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Nota (es. CV inviato il…)"
          value={note}
          disabled={saving}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save({ status: status || 'interessante', note })}
          onBlur={() => note !== (job.tracking?.note ?? '') && save({ status: status || 'interessante', note })}
        />
        <code className="muted small" title="Codice per la riga di comando: job-searcher track <codice> <stato>">
          {job.shortId}
        </code>
      </div>
      {error && <p className="error-box small">{error}</p>}
    </article>
  );
}
