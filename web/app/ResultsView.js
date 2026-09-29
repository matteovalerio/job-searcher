'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import JobCard from './JobCard.js';

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

  async function load(n) {
    setState({ loading: true });
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, top: n }),
    });
    const data = await res.json();
    setState(res.ok ? data : { error: data.error });
  }

  useEffect(() => {
    load(15);
  }, [profile]);

  async function copy() {
    await navigator.clipboard.writeText(state.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-label="Prompt per Claude"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card stack">
        <div className="row">
          <h2>Confronta CV e offerte con Claude</h2>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>
            Chiudi
          </button>
        </div>
        <p className="small muted">
          Copia il testo, apri una nuova chat su claude.ai, <strong>allega il CV in PDF</strong> e incolla. Usa
          l&apos;abbonamento, non l&apos;API. Claude ordina le offerte per affinità usando i codici tra parentesi
          quadre, gli stessi che vedi qui.
        </p>
        <div className="row">
          <label className="small">
            Offerte migliori:{' '}
            <input
              type="number"
              min="1"
              max="40"
              value={top}
              onChange={(e) => setTop(Number(e.target.value))}
              onBlur={() => load(top)}
              style={{ width: 70 }}
            />
          </label>
          {state.count != null && <span className="muted small">{state.count} offerte nel testo</span>}
        </div>
        {state.loading && <p className="muted">Preparo il testo…</p>}
        {state.error && <div className="error-box">{state.error}</div>}
        {state.prompt && (
          <>
            <textarea readOnly rows={14} value={state.prompt} aria-label="Testo per Claude" />
            <div className="row">
              <button onClick={copy}>{copied ? 'Copiato ✓' : 'Copia'}</button>
              <a className="button secondary" href="https://claude.ai/new" target="_blank" rel="noreferrer">
                Apri claude.ai
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResultsView({ profiles, selected, initialResults, statuses }) {
  const router = useRouter();
  const [results, setResults] = useState(initialResults);
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [noBrowser, setNoBrowser] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [targetIndex, setTargetIndex] = useState(0);
  const [showMatch, setShowMatch] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/results?profile=${encodeURIComponent(selected)}`);
    setResults(await res.json());
  }

  async function runSearch() {
    setRunning(true);
    setLog([]);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: selected, noBrowser }),
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
  }

  const target = results?.targets[targetIndex] ?? results?.targets[0];
  const jobs = useMemo(() => {
    if (!target) return [];
    const q = query.trim().toLowerCase();
    return target.jobs.filter(
      (j) =>
        (!onlyNew || j.isNew) &&
        (!q || [j.title, j.company, j.location, j.infoText, j.description].join(' ').toLowerCase().includes(q)),
    );
  }, [target, query, onlyNew]);

  const current = profiles.find((p) => p.id === selected);
  return (
    <div className="stack">
      <div className="row">
        <h1>Offerte</h1>
        <span className="spacer" />
        <select aria-label="Profilo" value={selected} onChange={(e) => router.push(`/?profile=${e.target.value}`)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? p.id}
            </option>
          ))}
        </select>
      </div>
      {current?.description && <p className="muted small">{current.description}</p>}

      <div className="card stack">
        <div className="row">
          <button onClick={runSearch} disabled={running}>
            {running ? 'Ricerca in corso…' : 'Avvia ricerca'}
          </button>
          <label className="small muted">
            <input type="checkbox" checked={noBrowser} onChange={(e) => setNoBrowser(e.target.checked)} /> senza Indeed
            e InfoJobs (niente browser)
          </label>
          {results && (
            <button className="secondary" onClick={() => setShowMatch(true)} disabled={running}>
              Prompt per Claude
            </button>
          )}
          <span className="spacer" />
          {results?.date && (
            <span className="muted small">Ultima ricerca: {new Date(results.date).toLocaleString('it-IT')}</span>
          )}
        </div>
        {running && (
          <p className="muted small">Può richiedere qualche minuto: alcune fonti rispondono lentamente di proposito.</p>
        )}
        {log.length > 0 && (
          <div className="log" role="log">
            {log.map((l, i) => (
              <div key={i} className={l.cls}>
                {l.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {showMatch && <MatchPrompt profile={selected} onClose={() => setShowMatch(false)} />}

      {!results ? (
        <div className="card empty">Nessuna ricerca ancora per questo profilo: premi «Avvia ricerca».</div>
      ) : (
        <>
          <div className="tabs">
            {results.targets.map((t, i) => (
              <button key={t.target.id} className={i === targetIndex ? 'active' : ''} onClick={() => setTargetIndex(i)}>
                {t.target.label} ({t.jobs.length})
              </button>
            ))}
          </div>
          <div className="row">
            <input
              type="search"
              placeholder="Filtra per testo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="small">
              <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> solo nuove
            </label>
            {target?.rejectedCount > 0 && (
              <span className="muted small">{target.rejectedCount} scartate dai filtri</span>
            )}
          </div>
          {jobs.length === 0 ? (
            <div className="card empty">Nessuna offerta con questi filtri.</div>
          ) : (
            jobs.map((job) => <JobCard key={job.id} job={job} statuses={statuses} onTracked={onTracked} />)
          )}
        </>
      )}
    </div>
  );
}
