'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { relativeDay, shortDate } from '../../lib/format.js';
import { ClockIcon, PlusIcon, TrashIcon } from '../icons.js';
import KitModal from '../KitModal.js';

/** Colonne della bacheca: le ultime tre situazioni finiscono tutte in "Chiuse". */
const COLUMNS = [
  { id: 'todo', name: 'Da candidarsi', statuses: ['interessante'], dot: 'var(--muted)' },
  { id: 'sent', name: 'Candidato', statuses: ['candidatura'], dot: 'var(--blue)' },
  { id: 'interview', name: 'Colloquio', statuses: ['colloquio'], dot: 'var(--accent)' },
  { id: 'closed', name: 'Chiuse', statuses: ['offerta', 'rifiutata', 'nessuna', 'scartata'], dot: 'var(--grey-dot)' },
];

function when(item, statuses) {
  const since = [...item.history].reverse().find((h) => h.status === item.status)?.at ?? item.updatedAt;
  switch (item.status) {
    case 'interessante':
      return `Aggiunta ${relativeDay(since)}`;
    case 'candidatura':
      return `Inviata il ${shortDate(item.sentAt ?? since)}`;
    case 'colloquio':
      return item.interview?.at
        ? `Colloquio il ${new Date(item.interview.at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
        : `Colloquio dal ${shortDate(since)}`;
    default:
      return `${statuses[item.status]} · ${shortDate(since)}`;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function Card({ item, statuses, hasKit, onChange, onRemove, onKit, dragging, onDragStart, onDragEnd }) {
  const [note, setNote] = useState(item.note ?? '');
  return (
    <article
      className={`app-card${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.job.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(item);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="top">
        <a href={item.job.url} target="_blank" rel="noopener noreferrer">
          {item.job.title}
        </a>
        {item.job.score != null && (
          <span className="mini-score" title="Punteggio">
            {item.job.score}
          </span>
        )}
      </div>
      <div className="muted small">{[item.job.company, item.job.location].filter(Boolean).join(' · ')}</div>
      {item.status === 'candidatura' && item.followUpAt && (
        <span className={`badge${item.followUpAt <= today() ? '' : ' warn'}`}>
          {item.followUpAt <= today() ? 'Da sollecitare' : `Sollecito il ${shortDate(item.followUpAt)}`}
        </span>
      )}
      <select
        aria-label={`Stato di "${item.job.title}"`}
        value={item.status}
        onChange={(e) => onChange(item, { status: e.target.value, note })}
      >
        {Object.entries(statuses).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <input
        type="text"
        aria-label={`Nota su "${item.job.title}"`}
        placeholder="Nota"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (item.note ?? '') && onChange(item, { status: item.status, note })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="foot">
        <ClockIcon />
        <span className="spacer">{when(item, statuses)}</span>
        <button type="button" className="small ghost" onClick={() => onKit(item)}>
          {hasKit ? 'Kit' : 'Prepara il kit'}
        </button>
        <button
          type="button"
          className="icon"
          onClick={() => onRemove(item)}
          aria-label={`Smetti di seguire "${item.job.title}"`}
          title="Smetti di seguire"
        >
          <TrashIcon />
        </button>
      </div>
    </article>
  );
}

export default function TrackingBoard({ initialItems, statuses, kitIds = [] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState(null);
  const [over, setOver] = useState(null);
  const [closing, setClosing] = useState(null); // offerta trascinata in "Chiuse": si chiede com'è finita
  const [kit, setKit] = useState(null);
  const [kits, setKits] = useState(() => new Set(kitIds));
  const closeKit = useCallback(() => setKit(null), []);
  const due = items.filter((i) => i.status === 'candidatura' && i.followUpAt && i.followUpAt <= today());

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
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.job.id !== item.job.id));
      router.refresh();
    }
  }

  function drop(column) {
    const item = dragged;
    setOver(null);
    setDragged(null);
    if (!item || column.statuses.includes(item.status)) return;
    if (column.statuses.length === 1) change(item, { status: column.statuses[0], note: item.note });
    else setClosing(item);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Candidature</h1>
          <p>Le offerte che stai seguendo, dalla prima occhiata alla risposta.</p>
        </div>
        <Link href="/" className="button">
          <PlusIcon />
          Aggiungi dalle offerte
        </Link>
      </header>
      {error && <p className="error-box">{error}</p>}
      {due.length > 0 && (
        <div className="card due-box">
          <strong>
            {due.length === 1 ? 'Una candidatura da sollecitare' : `${due.length} candidature da sollecitare`}
          </strong>
          <span className="small muted">
            Apri il kit per il testo del sollecito, poi segna «Sollecito inviato»: il prossimo si programma da solo.
          </span>
          <div className="row">
            {due.map((i) => (
              <button key={i.job.id} type="button" className="small" onClick={() => setKit(i)}>
                {i.job.title}
                {i.job.company ? ` · ${i.job.company}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      {kit && (
        <KitModal
          job={kit.job.id}
          title={kit.job.title}
          onClose={closeKit}
          onTracked={(updated) => setItems((prev) => prev.map((i) => (i.job.id === updated.job.id ? updated : i)))}
        />
      )}
      {!items.length && (
        <div className="empty">
          Non stai seguendo nessuna offerta. Nella pagina Offerte scegli uno stato accanto a quella che ti interessa.
        </div>
      )}
      <div className="board">
        {COLUMNS.map((col) => {
          const cards = items.filter((i) => col.statuses.includes(i.status));
          return (
            <section
              key={col.id}
              className={`column${over === col.id ? ' drop' : ''}`}
              aria-labelledby={`col-${col.id}`}
              onDragOver={(e) => {
                if (!dragged) return;
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                drop(col);
              }}
            >
              <div className="column-head">
                <span className="dot" style={{ background: col.dot }} />
                <h2 id={`col-${col.id}`}>{col.name}</h2>
                <span className="count">{cards.length}</span>
              </div>
              {col.id === 'closed' && closing && (
                <div className="close-choice">
                  <span className="small">Com&apos;è finita con «{closing.job.title}»?</span>
                  {col.statuses.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="small"
                      onClick={() => {
                        change(closing, { status: s, note: closing.note });
                        setClosing(null);
                      }}
                    >
                      {statuses[s]}
                    </button>
                  ))}
                  <button type="button" className="small ghost" onClick={() => setClosing(null)}>
                    Annulla
                  </button>
                </div>
              )}
              {cards.map((item) => (
                <Card
                  key={item.job.id}
                  item={item}
                  statuses={statuses}
                  onChange={change}
                  onRemove={remove}
                  onKit={(i) => {
                    setKit(i);
                    setKits((prev) => new Set(prev).add(i.job.id));
                  }}
                  hasKit={kits.has(item.job.id)}
                  dragging={dragged?.job.id === item.job.id}
                  onDragStart={setDragged}
                  onDragEnd={() => {
                    setDragged(null);
                    setOver(null);
                  }}
                />
              ))}
              {!cards.length && <div className="drop-hint">Trascina qui una candidatura</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
