'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarIcon, CopyIcon, ExternalIcon, SparkIcon } from '../icons.js';
import Modal from '../Modal.js';

const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];

/** Sito dell'evento, oppure una ricerca del nome (se il sito non è sicuro non lo si scrive). */
const linkOf = (item) => item.site ?? `https://www.google.com/search?q=${encodeURIComponent(item.name)}`;

function groupLabel(e) {
  if (e.monthsAway === 0) return 'Questo mese';
  if (e.monthsAway === 1) return 'Il mese prossimo';
  return `${MONTHS[e.nextMonth - 1]} ${e.nextYear}`;
}

function PrepareModal({ event, onClose }) {
  const [state, setState] = useState({ loading: true });
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch('/api/events/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id }),
    });
    const data = await res.json();
    setState(res.ok ? data : { error: data.error });
  }, [event.id]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Modal title={`Prepara la visita — ${event.name}`} onClose={onClose} wide>
      <p className="small muted" style={{ margin: 0 }}>
        Il testo contiene il tuo CV e le aziende della tua lista. Claude prepara la presentazione di 30 secondi, le
        domande da fare e come fare seguito, senza inventare nulla su di te né sull'evento.
      </p>
      {state.loading && <p className="muted">Preparo il testo…</p>}
      {state.error && <p className="error-box">{state.error}</p>}
      {state.prompt && (
        <>
          <textarea className="code" readOnly rows={14} value={state.prompt} aria-label="Testo per Claude" />
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.prompt);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <CopyIcon />
              {copied ? 'Copiato' : 'Copia'}
            </button>
            <a className="button" href="https://claude.ai/new" target="_blank" rel="noreferrer">
              Apri claude.ai <ExternalIcon />
            </a>
          </div>
        </>
      )}
    </Modal>
  );
}

function EventCard({ e, onPrepare }) {
  return (
    <article className="card event">
      <div className="event-head">
        <a href={linkOf(e)} target="_blank" rel="noopener noreferrer" className="event-name">
          {e.name} <ExternalIcon size={12} />
        </a>
        <span className="badge warn">{e.kind}</span>
      </div>
      <div className="small muted">
        {e.city}
        {e.distanceKm != null && ` · ${e.distanceKm} km`} · di solito a {e.when}
      </div>
      <p className="small" style={{ margin: 0 }}>
        {e.about}
      </p>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        {e.tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="row">
        <a className="button small" href={`/api/events/ics?id=${encodeURIComponent(e.id)}`} download>
          <CalendarIcon size={14} />
          Promemoria nel calendario
        </a>
        <button type="button" className="small ghost" onClick={() => onPrepare(e)}>
          <SparkIcon size={14} />
          Prepara la visita con Claude
        </button>
      </div>
    </article>
  );
}

export default function EventsView({ events, associations, home }) {
  const [preparing, setPreparing] = useState(null);
  const close = useCallback(() => setPreparing(null), []);
  const groups = [];
  for (const e of events) {
    const label = groupLabel(e);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push(e);
  }
  return (
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Eventi e associazioni</h1>
          <p>
            Fiere, festival e associazioni del settore: nell'editoria i contatti di persona contano molto. Le date
            cambiano ogni anno: il promemoria ti ricorda di controllarle sul sito
            {home ? `; la distanza è da ${home}` : ''}.
          </p>
        </div>
      </header>

      {groups.map((g) => (
        <section key={g.label} className="stack">
          <h2>
            {g.label}
            {g.label === 'Questo mese' && <span className="small faint"> · controlla se è già passato</span>}
          </h2>
          <div className="events-grid">
            {g.items.map((e) => (
              <EventCard key={e.id} e={e} onPrepare={setPreparing} />
            ))}
          </div>
        </section>
      ))}

      <section className="card stack">
        <h2>Associazioni</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Gli elenchi dei soci sono liste di aziende a cui candidarsi; molte offrono corsi, eventi locali e annunci.
        </p>
        <ul className="todo">
          {associations.map((a) => (
            <li key={a.id}>
              <span>
                <a href={linkOf(a)} target="_blank" rel="noopener noreferrer">
                  <strong>{a.name}</strong>
                </a>
                <span className="muted"> · {a.about}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {preparing && <PrepareModal event={preparing} onClose={close} />}
    </div>
  );
}
