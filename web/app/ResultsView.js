'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBusy } from './Busy.js';
import { CopyIcon, ExternalIcon, RefreshIcon, SearchIcon, SparkIcon } from './icons.js';
import JobCard from './JobCard.js';
import Modal from './Modal.js';
import TailorModal from './TailorModal.js';

function formatEvent(e) {
  const where = e.target ? `${e.target} · ${e.source}` : '';
  switch (e.type) {
    case 'begin':
      return { cls: '', text: `Ricerca "${e.profile}"` };
    case 'done': {
      const reasons = Object.entries(e.reasons ?? {})
        .map(([r, n]) => `${n} ${r}`)
        .join(', ');
      return {
        cls: 'ok',
        text: `✓ ${where}: ${e.kept} pertinenti su ${e.fetched}${reasons ? ` (scartate: ${reasons})` : ''}`,
      };
    }
    case 'skip':
      return { cls: 'warn', text: `- ${where}: saltata (${e.message})` };
    case 'warn':
      return { cls: 'warn', text: `! ${where}: ${e.message}` };
    case 'error':
      return { cls: 'error', text: `✗ ${where}: ${e.message}` };
    case 'finished':
      return {
        cls: '',
        text: `Fatto: ${e.total} offerte, ${e.fresh} nuove${e.hidden ? `, ${e.hidden} nascoste` : ''}.`,
      };
    case 'failed':
      return { cls: 'error', text: `Errore: ${e.message}` };
    default:
      return null;
  }
}

/** Testo per claude.ai che confronta il candidato con le offerte migliori dell'ultima ricerca. */
function MatchPrompt({ profile, onClose }) {
  const [top, setTop] = useState(15);
  const [state, setState] = useState({ loading: true });
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (n) => {
      setState({ loading: true });
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, top: n }),
      });
      const data = await res.json();
      setState(res.ok ? data : { error: data.error });
    },
    [profile],
  );

  useEffect(() => {
    load(15);
  }, [load]);

  async function copy() {
    await navigator.clipboard.writeText(state.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal title="Confronta CV e offerte con Claude" onClose={onClose}>
      <p className="small muted">
        Copia il testo, apri una nuova chat su claude.ai, <strong>allega il CV in PDF</strong> e incolla. Usa il tuo
        abbonamento, non l&apos;API. Claude chiama le offerte con i codici tra parentesi quadre, gli stessi che vedi
        qui.
      </p>
      <div className="row small">
        <label htmlFor="match-top">Offerte migliori</label>
        <input
          id="match-top"
          type="number"
          min="1"
          max="40"
          value={top}
          onChange={(e) => setTop(Number(e.target.value))}
          onBlur={() => load(top)}
        />
        {state.count != null && <span className="muted">{state.count} offerte nel testo</span>}
      </div>
      {state.loading && <p className="muted">Preparo il testo…</p>}
      {state.error && <div className="error-box">{state.error}</div>}
      {state.prompt && (
        <>
          <textarea className="code" readOnly rows={14} value={state.prompt} aria-label="Testo per Claude" />
          <div className="row">
            <button type="button" className="primary" onClick={copy}>
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

const PAGE_SIZE = 30;

export default function ResultsView({ profile, initialResults, statuses }) {
  const router = useRouter();
  const [results, setResults] = useState(initialResults);
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [noBrowser, setNoBrowser] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [targetIndex, setTargetIndex] = useState(0);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [showMatch, setShowMatch] = useState(false);
  const closeMatch = useCallback(() => setShowMatch(false), []);
  const [tailor, setTailor] = useState(null);
  const closeTailor = useCallback(() => setTailor(null), []);

  // Durante la ricerca la pagina è bloccata: l'ultima riga dell'avanzamento compare sotto la rotella.
  const { setDetail } = useBusy();
  useEffect(() => {
    if (running) setDetail(log.at(-1)?.text);
  }, [running, log, setDetail]);

  async function refresh() {
    const res = await fetch(`/api/results?profile=${encodeURIComponent(profile.id)}`);
    setResults(await res.json());
    router.refresh(); // aggiorna i numeri nella barra laterale
  }

  async function runSearch() {
    setRunning(true);
    setLog([]);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: profile.id, noBrowser }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // L'avanzamento arriva una riga JSON alla volta.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        const events = lines
          .filter(Boolean)
          .map((l) => formatEvent(JSON.parse(l)))
          .filter(Boolean);
        if (events.length) setLog((prev) => [...prev, ...events]);
      }
      await refresh();
    } catch (err) {
      setLog((prev) => [...prev, { cls: 'error', text: `Errore: ${err.message}` }]);
    } finally {
      setRunning(false);
    }
  }

  function onTracked(jobId, item) {
    setResults((prev) => ({
      ...prev,
      targets: prev.targets.map((t) => ({
        ...t,
        jobs: t.jobs
          .map((j) =>
            j.id === jobId
              ? { ...j, tracking: { status: item.status, label: statuses[item.status], note: item.note } }
              : j,
          )
          // "non mi interessa" e "non selezionata" spariscono dai risultati, come nella riga di comando
          .filter((j) => !['scartata', 'rifiutata'].includes(j.tracking?.status)),
      })),
    }));
    router.refresh();
  }

  const target = results?.targets[targetIndex] ?? results?.targets[0];
  const jobs = useMemo(() => {
    if (!target) return [];
    const q = query.trim().toLowerCase();
    return target.jobs.filter(
      (j) =>
        (!onlyNew || j.isNew) &&
        (!q ||
          [j.title, j.company, j.location, j.infoText, j.description, ...(j.tags ?? [])]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    );
  }, [target, query, onlyNew]);

  // Cambiando zona o filtri si riparte dalle prime offerte.
  const resetPaging = (fn) => (value) => {
    fn(value);
    setShown(PAGE_SIZE);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Offerte</h1>
          <p>{profile.description || profile.name || profile.id}</p>
        </div>
        <div className="row">
          {results && (
            <button type="button" onClick={() => setShowMatch(true)} disabled={running}>
              <SparkIcon />
              Prompt per Claude
            </button>
          )}
          <button type="button" className="primary" onClick={runSearch} disabled={running}>
            <RefreshIcon />
            {running ? 'Ricerca in corso…' : 'Avvia ricerca'}
          </button>
        </div>
      </header>

      <div className="statusbar">
        <label>
          <input type="checkbox" checked={noBrowser} onChange={(e) => setNoBrowser(e.target.checked)} />
          Salta InfoJobs (niente browser)
        </label>
        {running ? (
          <span>Può richiedere qualche minuto: alcune fonti rispondono lentamente di proposito.</span>
        ) : (
          results?.date && (
            <span className="when">
              <span className="dot" />
              Ultima ricerca{' '}
              <span className="mono">
                {new Date(results.date).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </span>
          )
        )}
      </div>

      {log.length > 0 && (
        <div className="log" role="log">
          {log.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: il registro cresce solo in coda
            <div key={i} className={l.cls}>
              {l.text}
            </div>
          ))}
        </div>
      )}

      {showMatch && <MatchPrompt profile={profile.id} onClose={closeMatch} />}
      {tailor && <TailorModal target={tailor} onClose={closeTailor} />}

      {!results ? (
        <div className="empty">Nessuna ricerca ancora per questo profilo: premi «Avvia ricerca».</div>
      ) : (
        <>
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Zona">
              {results.targets.map((t, i) => (
                <button
                  type="button"
                  role="tab"
                  key={t.target.id}
                  aria-selected={t === target}
                  onClick={() => resetPaging(setTargetIndex)(i)}
                >
                  {t.target.label} <span className="pill">{t.jobs.length}</span>
                </button>
              ))}
            </div>
            <div className="search">
              <SearchIcon />
              <label htmlFor="q" className="sr-only">
                Filtra per testo
              </label>
              <input
                id="q"
                type="search"
                placeholder="Filtra per titolo, azienda, parola chiave…"
                value={query}
                onChange={(e) => resetPaging(setQuery)(e.target.value)}
              />
            </div>
            <label className="switch">
              <input type="checkbox" checked={onlyNew} onChange={(e) => resetPaging(setOnlyNew)(e.target.checked)} />
              Solo nuove
            </label>
            {target?.rejectedCount > 0 && (
              <span className="faint small" title="Offerte trovate ma scartate dalle regole del profilo">
                {target.rejectedCount} scartate dai filtri
              </span>
            )}
          </div>

          {jobs.length === 0 ? (
            <div className="empty">Nessuna offerta con questi filtri.</div>
          ) : (
            <div className="jobs">
              <div className="jobs-head overline" aria-hidden="true">
                <span>Match</span>
                <span>Offerta</span>
                <span>Pubblicata</span>
                <span>Stato</span>
              </div>
              {jobs.slice(0, shown).map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  statuses={statuses}
                  onTracked={onTracked}
                  onTailor={() => setTailor({ job: job.id })}
                />
              ))}
              <div className="jobs-foot">
                <span>
                  {Math.min(shown, jobs.length)} di {jobs.length} offerte
                </span>
                {shown < jobs.length && (
                  <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Mostra altre
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
