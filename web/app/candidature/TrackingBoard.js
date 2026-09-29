'use client';

import { useState } from 'react';

function Item({ item, statuses, onChange, onRemove }) {
  const [note, setNote] = useState(item.note ?? '');
  const date = (iso) => new Date(iso).toLocaleDateString('it-IT');
  return (
    <div className="card stack">
      <div>
        <a href={item.job.url} target="_blank" rel="noopener noreferrer">
          <strong>{item.job.title}</strong>
        </a>
        <p className="meta">{[item.job.company, item.job.location].filter(Boolean).join(' · ')}</p>
        <p className="meta small">{item.history.map((h) => `${statuses[h.status]} ${date(h.at)}`).join(' → ')}</p>
      </div>
      <div className="row">
        <select
          aria-label="Stato"
          value={item.status}
          onChange={(e) => onChange(item, { status: e.target.value, note })}
        >
          {Object.entries(statuses).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button className="danger" onClick={() => onRemove(item)} title="Smetti di seguire questa offerta">
          Rimuovi
        </button>
      </div>
      <input
        type="text"
        placeholder="Nota"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (item.note ?? '') && onChange(item, { status: item.status, note })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </div>
  );
}

export default function TrackingBoard({ initialItems, statuses }) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState('');

  async function change(item, { status, note }) {
    setError('');
    const res = await fetch('/api/tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: item.job, status, note }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setItems((prev) => prev.map((i) => (i.job.id === item.job.id ? body : i)));
  }

  async function remove(item) {
    if (!confirm(`Smettere di seguire "${item.job.title}"?`)) return;
    const res = await fetch(`/api/tracking?id=${encodeURIComponent(item.job.id)}`, { method: 'DELETE' });
    if (res.ok) setItems((prev) => prev.filter((i) => i.job.id !== item.job.id));
  }

  if (!items.length) {
    return (
      <div className="stack">
        <h1>Candidature</h1>
        <div className="card empty">
          Non stai seguendo nessuna offerta. Nella pagina Offerte scegli uno stato accanto all&apos;offerta che ti
          interessa.
        </div>
      </div>
    );
  }
  const groups = Object.keys(statuses)
    .map((key) => ({ key, items: items.filter((i) => i.status === key) }))
    .filter((g) => g.items.length);
  return (
    <div className="stack">
      <h1>Candidature</h1>
      {error && <p className="error-box">{error}</p>}
      <div className="board">
        {groups.map((g) => (
          <section key={g.key} className="stack">
            <h2>
              {statuses[g.key]} <span className="muted small">({g.items.length})</span>
            </h2>
            {g.items.map((item) => (
              <Item key={item.job.id} item={item} statuses={statuses} onChange={change} onRemove={remove} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
