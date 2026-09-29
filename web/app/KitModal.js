'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { shortDate } from '../lib/format.js';
import { CheckIcon, CopyIcon, ExternalIcon } from './icons.js';
import Modal from './Modal.js';

const TABS = [
  { id: 'analysis', label: 'Analisi' },
  { id: 'cv', label: 'CV' },
  { id: 'email', label: 'Email' },
  { id: 'followup', label: 'Sollecito' },
  { id: 'claude', label: 'Con Claude' },
];

async function send(url, method, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function CopyButton({ text, label = 'Copia', primary = false }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={primary ? 'primary small' : 'small'}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copiato' : label}
    </button>
  );
}

/** Scelta tra la versione interna e quella di Claude, se c'è. */
function VersionSwitch({ kit, version, setVersion }) {
  if (!kit.claude) return null;
  return (
    <div className="segmented" role="tablist" aria-label="Versione">
      <button type="button" role="tab" aria-selected={version === 'claude'} onClick={() => setVersion('claude')}>
        Di Claude
      </button>
      <button type="button" role="tab" aria-selected={version === 'internal'} onClick={() => setVersion('internal')}>
        Automatica
      </button>
    </div>
  );
}

function Warnings({ kit, version }) {
  if (version !== 'claude' || !kit.claude?.warnings?.length) return null;
  return (
    <div className="error-box small">
      <strong>Da controllare prima di inviare:</strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {kit.claude.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function Analysis({ kit, onRedo }) {
  const [text, setText] = useState('');
  const c = kit.company;
  return (
    <div className="stack">
      {kit.claude?.analysis && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="overline">Cosa cerca l'azienda, secondo Claude</span>
          <p className="small" style={{ margin: 0, whiteSpace: 'pre-line' }}>
            {kit.claude.analysis}
          </p>
        </div>
      )}
      <div className="grid-2 even">
        <div className="stack" style={{ gap: 6 }}>
          <span className="overline">L'azienda</span>
          <p className="small" style={{ margin: 0 }}>
            <strong>{c.name ?? 'Azienda non indicata'}</strong>
            {c.kindLabel && <span className="muted"> · {c.kindLabel}</span>}
            {c.known && <span className="muted"> · è nel tuo elenco</span>}
          </p>
          {c.website && (
            <a className="small" href={c.website} target="_blank" rel="noreferrer">
              {c.website} <ExternalIcon />
            </a>
          )}
          {c.careersUrl && (
            <a className="small" href={c.careersUrl} target="_blank" rel="noreferrer">
              Lavora con noi <ExternalIcon />
            </a>
          )}
          {c.specialties?.length > 0 && <p className="small muted">Specializzazioni: {c.specialties.join(', ')}</p>}
          {(c.about?.length > 0 || c.description) && (
            <p className="small muted" style={{ margin: 0 }}>
              {c.about?.join(' ') || c.description}
            </p>
          )}
          {!c.website && (
            <p className="small faint" style={{ margin: 0 }}>
              Il sito non si ricava dall'annuncio: aggiungi l'azienda in «Case editrici e affini» per visitarlo.
            </p>
          )}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="overline">Da valorizzare</span>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {(kit.emphasis.focus.length ? kit.emphasis.focus : ['ciò che nel CV è più vicino alle mansioni']).map(
              (f) => (
                <li key={f}>{f}</li>
              ),
            )}
          </ul>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="overline">Cosa chiede l'annuncio e cosa mostra il tuo CV</span>
        {!kit.hasCv && (
          <p className="error-box small">
            Nessun CV salvato: caricalo in «Mercato» o in «CV su misura» per il confronto.
          </p>
        )}
        <ul className="kit-reqs">
          {kit.covered.map((r) => (
            <li key={r.requirement} className="ok">
              <span className="req">
                {r.requirement}
                {r.task && <span className="faint"> · mansione</span>}
              </span>
              <span className="evidence">nel CV: «{r.evidence.join('» / «')}»</span>
              {r.note && <span className="evidence warn">{r.note}</span>}
            </li>
          ))}
          {kit.missing.map((m) => (
            <li key={m} className="gap">
              <span className="req">{m}</span>
              <span className="evidence">
                Non lo trovo nel CV: non scriverlo. Se è vero, aggiungilo al CV; altrimenti preparati a parlarne al
                colloquio.
              </span>
            </li>
          ))}
        </ul>
        {kit.claude?.gaps?.length > 0 && (
          <>
            <span className="overline">Consigli di Claude sulle lacune</span>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {kit.claude.gaps.map((g) => (
                <li key={g.requirement}>
                  <strong>{g.requirement}</strong>: {g.advice}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {kit.shortText && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="overline">Il testo dell'annuncio è breve</span>
          <p className="small muted" style={{ margin: 0 }}>
            Molti portali ne mostrano solo un pezzo. Aprilo dal link, copia il testo completo e incollalo qui: l'analisi
            sarà molto più precisa.
          </p>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Testo dell'annuncio" />
          <div className="row">
            <button type="button" className="small" disabled={!text.trim()} onClick={() => onRedo(text)}>
              Rifai l'analisi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CvTab({ kit, version }) {
  const text = version === 'claude' ? kit.claude.cv : kit.cv?.text;
  const changes = version === 'claude' ? kit.claude.changes : kit.cv?.changes;
  if (!text) {
    return <p className="muted">Serve il CV salvato: caricalo in «Mercato» o nella finestra «CV su misura».</p>;
  }
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        {version === 'claude'
          ? 'Il CV riscritto da Claude. Controlla le segnalazioni qui sotto prima di usarlo.'
          : 'Solo righe del tuo CV, riordinate: in ogni esperienza prima i punti che rispondono all’annuncio. Per riscriverle con le parole dell’annuncio usa «Con Claude».'}
      </p>
      <Warnings kit={kit} version={version} />
      <textarea className="code" readOnly rows={16} value={text} aria-label="CV adattato" />
      <div className="row">
        <CopyButton text={text} primary />
      </div>
      {changes?.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MailTab({ mail, to, version, kit, note }) {
  const mailto = `mailto:${to ?? ''}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
  return (
    <div className="stack">
      <Warnings kit={kit} version={version} />
      <div className="stack" style={{ gap: 4 }}>
        <span className="overline">A</span>
        <span className="small">
          {to ?? (
            <span className="muted">indirizzo non trovato: usa il modulo o l'indirizzo indicato nell'annuncio</span>
          )}
        </span>
      </div>
      <label className="stack" style={{ gap: 4 }}>
        <span className="overline">Oggetto</span>
        <input type="text" readOnly value={mail.subject} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="overline">Testo</span>
        <textarea className="code" readOnly rows={12} value={mail.body} />
      </label>
      <div className="row">
        <CopyButton text={mail.body} label="Copia il testo" primary />
        <CopyButton text={mail.subject} label="Copia l'oggetto" />
        <a className="button small" href={mailto}>
          Apri nel programma di posta <ExternalIcon />
        </a>
      </div>
      {note && <p className="small faint">{note}</p>}
    </div>
  );
}

function ClaudeTab({ prompt, onImported, job }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  async function importAnswer() {
    setError('');
    try {
      onImported(await send('/api/kit', 'PUT', { job, answer }));
      setAnswer('');
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Il testo contiene il tuo CV, l'annuncio, quello che si sa dell'azienda e l'analisi automatica, con la regola di
        non inventare nulla. Incollalo su claude.ai, poi incolla qui tutta la risposta: il programma controlla numeri,
        strumenti, lingue e contatti che non sono nel tuo CV.
      </p>
      <textarea className="code" readOnly rows={10} value={prompt} aria-label="Testo per Claude" />
      <div className="row">
        <CopyButton text={prompt} primary />
        <a className="button small" href="https://claude.ai/new" target="_blank" rel="noreferrer">
          Apri claude.ai <ExternalIcon />
        </a>
      </div>
      <textarea
        rows={6}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Incolla qui la risposta di Claude (con il blocco ```json)"
        aria-label="Risposta di Claude"
      />
      <div className="row">
        <button type="button" className="primary small" disabled={!answer.trim()} onClick={importAnswer}>
          Importa la risposta
        </button>
      </div>
      {error && <p className="error-box small">{error}</p>}
    </div>
  );
}

/** Stato della candidatura: invio, solleciti programmati, esito. */
function StatusBar({ item, job, statuses, onChange }) {
  const [sentAt, setSentAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  async function update(body) {
    setError('');
    try {
      onChange(await send('/api/tracking', 'POST', { job: item?.job ?? job, ...body }));
    } catch (err) {
      setError(err.message);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="kit-status">
      <span className="small">
        {item ? (
          <>
            Stato: <strong>{statuses[item.status] ?? item.status}</strong>
            {item.sentAt && item.status === 'candidatura' && (
              <span className="muted"> dal {shortDate(item.sentAt)}</span>
            )}
          </>
        ) : (
          <span className="muted">Non stai seguendo questa offerta</span>
        )}
      </span>
      {item?.status !== 'candidatura' && !['colloquio', 'offerta', 'rifiutata', 'nessuna'].includes(item?.status) && (
        <span className="row" style={{ gap: 8 }}>
          {!item && (
            <button type="button" className="small ghost" onClick={() => update({ status: 'interessante' })}>
              Mi interessa
            </button>
          )}
          <input
            type="date"
            value={sentAt}
            max={today}
            onChange={(e) => setSentAt(e.target.value)}
            aria-label="Data di invio"
            style={{ width: 'auto' }}
          />
          <button type="button" className="primary small" onClick={() => update({ status: 'candidatura', sentAt })}>
            Segna come inviata
          </button>
        </span>
      )}
      {item?.status === 'candidatura' && (
        <span className="row" style={{ gap: 8 }}>
          {item.followUpAt ? (
            <span className={`small ${item.followUpAt <= today ? 'due' : 'muted'}`}>
              {item.followUpAt <= today ? 'Da sollecitare oggi' : `Sollecito il ${shortDate(item.followUpAt)}`}
              {item.followUps?.length ? ` · ${item.followUps.length} già inviati` : ''}
            </span>
          ) : (
            <span className="small muted">Solleciti finiti: se non rispondono, segna «nessuna risposta».</span>
          )}
          {item.followUpAt && (
            <button type="button" className="small" onClick={() => update({ action: 'followup' })}>
              Sollecito inviato
            </button>
          )}
          <button type="button" className="small ghost" onClick={() => update({ status: 'colloquio' })}>
            Colloquio
          </button>
          <button type="button" className="small ghost" onClick={() => update({ status: 'nessuna' })}>
            Nessuna risposta
          </button>
        </span>
      )}
      {error && <span className="error-box small">{error}</span>}
    </div>
  );
}

/**
 * Kit di candidatura per un'offerta: analisi, CV, email, sollecito e testo per Claude.
 * @param {{ job: string }} props  id (o codice) dell'offerta
 */
export default function KitModal({ job, title, onClose, onTracked }) {
  const [state, setState] = useState({ loading: true });
  const [tab, setTab] = useState('analysis');
  const [version, setVersion] = useState('internal');

  const build = useCallback(
    async (text) => {
      try {
        const data = await send('/api/kit', 'POST', { job, ...(text ? { text } : {}) });
        setState(data);
        setVersion(data.kit.claude ? 'claude' : 'internal');
      } catch (err) {
        setState({ error: err.message });
      }
    },
    [job],
  );

  // Una sola richiesta per offerta: in sviluppo React esegue gli effetti due volte, e due richieste insieme
  // salverebbero la candidatura due volte.
  const built = useRef(null);
  useEffect(() => {
    if (built.current === job) return;
    built.current = job;
    build();
  }, [build, job]);

  const { kit, item, prompt, statuses } = state;
  async function onChange(updated) {
    onTracked?.(updated);
    // Si ricarica il kit: il sollecito cita la data di invio.
    try {
      const data = await fetch(`/api/kit?job=${encodeURIComponent(job)}`).then((r) => r.json());
      setState((s) => ({ ...s, ...(data.kit ? data : {}), item: updated }));
    } catch {
      setState((s) => ({ ...s, item: updated }));
    }
  }
  const mail = kit && (version === 'claude' && kit.claude?.email?.body ? kit.claude.email : kit.email);
  const followUp = kit && (version === 'claude' && kit.claude?.followUp?.body ? kit.claude.followUp : kit.followUp);
  return (
    <Modal title={`Kit candidatura — ${title ?? kit?.job.title ?? ''}`} onClose={onClose} wide>
      {state.loading && <p className="muted">Preparo il kit…</p>}
      {state.error && <div className="error-box">{state.error}</div>}
      {kit && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="segmented" role="tablist" aria-label="Parti del kit">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {['cv', 'email', 'followup'].includes(tab) && (
              <VersionSwitch kit={kit} version={version} setVersion={setVersion} />
            )}
          </div>
          {tab === 'analysis' && <Analysis kit={kit} onRedo={build} />}
          {tab === 'cv' && <CvTab kit={kit} version={version} />}
          {tab === 'email' && (
            <MailTab
              mail={mail}
              to={kit.company.email}
              version={version}
              kit={kit}
              note="Ricordati di allegare il CV (in PDF). Dopo l'invio, segna la candidatura come inviata: il sollecito viene programmato da solo."
            />
          )}
          {tab === 'followup' && (
            <MailTab
              mail={followUp}
              to={kit.company.email}
              version={version}
              kit={kit}
              note="Il primo sollecito si manda una settimana dopo l'invio, il secondo dieci giorni dopo il primo."
            />
          )}
          {tab === 'claude' && (
            <ClaudeTab
              prompt={prompt}
              job={job}
              onImported={(data) => {
                setState((s) => ({ ...s, ...data }));
                setVersion('claude');
                setTab('cv');
              }}
            />
          )}
          {statuses && <StatusBar item={item} job={kit.job} statuses={statuses} onChange={onChange} />}
        </>
      )}
    </Modal>
  );
}
