'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { relativeDay, shortDate } from '../../lib/format.js';
import { CheckIcon, CopyIcon, ExternalIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon } from '../icons.js';
import Modal from '../Modal.js';
import TailorModal from '../TailorModal.js';

/** Gruppi di stati per il filtro in alto. */
const GROUPS = [
  { id: 'all', label: 'Tutte', statuses: null },
  { id: 'review', label: 'Da valutare', statuses: ['da_valutare'] },
  { id: 'todo', label: 'Da contattare', statuses: ['da_contattare'] },
  { id: 'open', label: 'In corso', statuses: ['inviata', 'sollecitata', 'colloquio'] },
  { id: 'closed', label: 'Chiuse', statuses: ['rifiutata', 'nessuna_risposta', 'scartata'] },
];

async function send(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Elenco preparato da Claude (o scritto a mano): si aggiunge e se ne visitano i siti. */
function ClaudeImport({ place, setPlace, radiusKm, onAdded }) {
  const [affine, setAffine] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState({});

  async function makePrompt() {
    setState({});
    try {
      const data = await send('/api/publishers/prompt', 'POST', { place, radiusKm, affine });
      setPrompt(data.prompt);
      await navigator.clipboard.writeText(data.prompt).then(
        () => setCopied(true),
        () => setCopied(false),
      );
    } catch (err) {
      setState({ error: err.message });
    }
  }

  async function importText() {
    setState({ loading: true });
    try {
      setState({ done: await send('/api/publishers/import', 'POST', { text }) });
    } catch (err) {
      setState({ error: err.message });
    }
  }

  if (state.done) {
    const { added, skipped } = state.done;
    return (
      <div className="stack">
        <p>
          Aggiunte {added.length}
          {skipped ? `, ${skipped} erano già nell'elenco` : ''}. Ho visitato i siti:
        </p>
        <div className="discover-list">
          {added.map((p) => (
            <div key={p.id} className="discover-item">
              <span className="stack" style={{ gap: 4 }}>
                <strong>{p.name}</strong>
                <span
                  className="small"
                  style={{ color: p.checkProblem || !p.website ? 'var(--accent-hover)' : undefined }}
                >
                  {!p.website
                    ? 'senza sito: da verificare a mano'
                    : p.checkProblem
                      ? `sito non raggiungibile: forse non esiste più (${p.checkProblem})`
                      : ['sito ok', p.email, p.careersUrl && 'lavora con noi ✓'].filter(Boolean).join(' · ')}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={() => onAdded(added)}>
            Fatto
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="Cosa chiedere a Claude">
        <button type="button" role="tab" aria-selected={!affine} onClick={() => setAffine(false)}>
          Case editrici
        </button>
        <button type="button" role="tab" aria-selected={affine} onClick={() => setAffine(true)}>
          Aziende affini al mio CV
        </button>
      </div>
      <p className="small muted">
        {affine
          ? 'Dal tuo CV Claude individua le competenze trasferibili, propone settori affini (anche meno ovvi) e aziende concrete della zona, con il ruolo da proporre.'
          : 'Claude conosce molti piccoli editori che non sono sulle mappe.'}{' '}
        Prepara il testo, incollalo su claude.ai e poi incolla qui la risposta; va bene anche un elenco scritto da te,
        una per riga («Nome | sito | città»). Prima di aggiungerle visito ogni sito, così quelle inventate o chiuse si
        riconoscono subito.
      </p>
      <div className="row">
        <label className="field" style={{ flex: '1 1 260px' }}>
          <span className="label">Zona</span>
          <input
            type="text"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="es. Padova, Venezia"
          />
        </label>
        <button type="button" onClick={makePrompt} style={{ alignSelf: 'flex-end' }}>
          <CopyIcon />
          {copied ? 'Testo copiato' : 'Prepara e copia il testo'}
        </button>
        <a
          className="button"
          href="https://claude.ai/new"
          target="_blank"
          rel="noreferrer"
          style={{ alignSelf: 'flex-end' }}
        >
          Apri claude.ai <ExternalIcon />
        </a>
      </div>
      {prompt && (
        <details>
          <summary>Mostra il testo</summary>
          <textarea
            className="code"
            readOnly
            rows={8}
            value={prompt}
            aria-label="Testo per Claude"
            style={{ marginTop: 12 }}
          />
        </details>
      )}
      <label className="field">
        <span className="label">Risposta di Claude o elenco</span>
        <textarea
          className="code"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            '```json\n[{ "name": "…", "website": "…", "city": "…" }]\n```\n\noppure: Wetlands | wetlandsbooks.com | Venezia'
          }
        />
      </label>
      <div className="row">
        <button type="button" className="primary" disabled={!text.trim() || state.loading} onClick={importText}>
          <PlusIcon />
          {state.loading ? 'Aggiungo e controllo i siti…' : 'Aggiungi e controlla i siti'}
        </button>
        {state.error && <span className="error-box">{state.error}</span>}
      </div>
    </div>
  );
}

/** Scelta dei settori: editoria e settori affini, con quelli consigliati per il profilo in evidenza. */
function SectorPicker({ sectors, chosen, onToggle }) {
  const group = (list) => (
    <div className="chips">
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={chosen.has(s.id)}
          onClick={() => onToggle(s.id)}
          title={`${s.why}. Ruoli: ${s.roles.join(', ')}`}
        >
          {chosen.has(s.id) && <CheckIcon />}
          {s.label}
          {s.recommended && <span className="badge">consigliato</span>}
        </button>
      ))}
    </div>
  );
  const affine = sectors.filter((s) => !s.publishing);
  const chosenAffine = affine.filter((s) => chosen.has(s.id));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="overline">Editoria</span>
      {group(sectors.filter((s) => s.publishing))}
      <span className="overline">Settori affini (le tue competenze servono anche qui)</span>
      {group(affine)}
      {chosenAffine.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          {chosenAffine.map((s) => (
            <li key={s.id}>
              <strong style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{s.label}</strong>: {s.why}. Ruoli da proporre:{' '}
              {s.roles.join(', ')}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiscoverModal({ defaultPlace, kinds, sectors, specialtyLabel, onAdded, onClose }) {
  const [place, setPlace] = useState(defaultPlace || 'Padova');
  const [radiusKm, setRadiusKm] = useState(30);
  const [state, setState] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState('maps');
  const [chosen, setChosen] = useState(() => new Set(sectors.filter((s) => s.publishing).map((s) => s.id)));
  const toggleSector = (id) =>
    setChosen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function search(e) {
    e.preventDefault();
    setState({ loading: true });
    try {
      const data = await send('/api/publishers/discover', 'POST', { place, radiusKm, sectors: [...chosen] });
      setState(data);
      setSelected(new Set(data.results.filter((r) => !r.known).map((r, i) => r.name + i)));
    } catch (err) {
      setState({ error: err.message });
    }
  }

  const fresh = (state.results ?? []).map((r, i) => ({ ...r, key: r.name + i }));
  async function add() {
    const items = fresh.filter((r) => selected.has(r.key)).map(({ key, known, sources, ...r }) => r);
    const data = await send('/api/publishers', 'POST', { items });
    onAdded(data.added);
  }

  const toggle = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <Modal title="Cerca case editrici e aziende affini" onClose={onClose} wide>
      <div className="segmented" role="tablist" aria-label="Modo di ricerca">
        <button type="button" role="tab" aria-selected={mode === 'maps'} onClick={() => setMode('maps')}>
          Mappe e web
        </button>
        <button type="button" role="tab" aria-selected={mode === 'claude'} onClick={() => setMode('claude')}>
          Con Claude o da un elenco
        </button>
      </div>
      {mode === 'claude' ? (
        <ClaudeImport place={place} setPlace={setPlace} radiusKm={radiusKm} onAdded={onAdded} />
      ) : (
        <>
          <p className="small muted">
            Cerca su OpenStreetMap, Wikidata e (se c&apos;è la chiave) sul web le aziende dei settori scelti attorno a
            una o più città, separate da virgole. Poi «Controlla sito» ne ricava specializzazione, email e pagina
            «lavora con noi».
          </p>
          <SectorPicker sectors={sectors} chosen={chosen} onToggle={toggleSector} />
          <form className="row" onSubmit={search}>
            <label className="field" style={{ flex: '1 1 220px' }}>
              <span className="label">Città</span>
              <input type="text" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="es. Padova" />
            </label>
            <label className="field" style={{ width: 140 }}>
              <span className="label">Raggio</span>
              <span className="with-unit">
                <input type="number" min="1" max="200" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
                <span>km</span>
              </span>
            </label>
            <button
              type="submit"
              className="primary"
              style={{ alignSelf: 'flex-end' }}
              disabled={state.loading || !chosen.size}
            >
              <SearchIcon />
              {state.loading ? 'Ricerca…' : 'Cerca'}
            </button>
          </form>
          {state.loading && <p className="muted small">Può richiedere fino a un minuto.</p>}
          {state.error && <p className="error-box">{state.error}</p>}
          {state.problems?.map((p) => (
            <p key={p} className="small" style={{ color: 'var(--accent-hover)' }}>
              ! {p}
            </p>
          ))}
          {state.results && !state.webSearch && (
            <p className="small faint">
              Mappe e Wikidata non conoscono molte piccole aziende: per trovarne di più usa «Con Claude o da un elenco»,
              oppure attiva la ricerca web con la chiave BRAVE_SEARCH_API_KEY (vedi README).
            </p>
          )}
          {state.results && (
            <>
              <p className="small muted">
                {state.results.length} trovate, {state.results.filter((r) => !r.known).length} nuove.
              </p>
              <div className="discover-list">
                {fresh.map((r) => (
                  <label key={r.key} className={`discover-item${r.known ? ' known' : ''}`}>
                    <input
                      type="checkbox"
                      disabled={r.known}
                      checked={!r.known && selected.has(r.key)}
                      onChange={() => toggle(r.key)}
                    />
                    <span className="stack" style={{ gap: 4 }}>
                      <span>
                        <strong>{r.name}</strong> <span className="faint small">{kinds[r.kind]}</span>
                        {r.known && <span className="badge warn"> già nell&apos;elenco</span>}
                      </span>
                      <span className="muted small">
                        {[r.city, r.distanceKm != null && `${r.distanceKm} km`, r.website, r.email]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {r.specialties?.length > 0 && (
                        <span className="tags">
                          {r.specialties.map((s) => (
                            <span key={s} className="tag">
                              {specialtyLabel(s)}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <div className="row">
                <button type="button" className="primary" disabled={!selected.size} onClick={add}>
                  <PlusIcon />
                  Aggiungi {selected.size} all&apos;elenco
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function AddModal({ kinds, onAdded, onClose }) {
  const [form, setForm] = useState({
    name: '',
    website: '',
    city: '',
    kind: 'casa-editrice',
    email: '',
    pitch: '',
    note: '',
  });
  const [state, setState] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  async function save(e) {
    e.preventDefault();
    setState({ saving: true });
    try {
      const data = await send('/api/publishers', 'POST', { publisher: form });
      onAdded(data.added);
    } catch (err) {
      setState({ error: err.message });
    }
  }
  return (
    <Modal title="Aggiungi un'azienda" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="grid-2 even">
          <label className="field">
            <span className="label">Nome</span>
            <input type="text" required value={form.name} onChange={set('name')} placeholder="es. Edizioni Esempio" />
          </label>
          <label className="field">
            <span className="label">Tipo</span>
            <select value={form.kind} onChange={set('kind')}>
              {Object.entries(kinds).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid-2 even">
          <label className="field">
            <span className="label">Sito</span>
            <input type="text" value={form.website} onChange={set('website')} placeholder="es. www.esempio.it" />
          </label>
          <label className="field">
            <span className="label">Città</span>
            <input type="text" value={form.city} onChange={set('city')} />
          </label>
        </div>
        <label className="field">
          <span className="label">Ruolo da proporre</span>
          <input
            type="text"
            value={form.pitch}
            onChange={set('pitch')}
            placeholder="es. correttore di bozze e impaginatore (utile per i settori affini)"
          />
        </label>
        <label className="field">
          <span className="label">Email per la candidatura</span>
          <input type="text" value={form.email} onChange={set('email')} placeholder="se la conosci" />
        </label>
        <label className="field">
          <span className="label">Note</span>
          <input type="text" value={form.note} onChange={set('note')} placeholder="es. conosco una redattrice" />
        </label>
        <p className="faint small">Se c&apos;è il sito, lo visito subito per capire specializzazione ed email.</p>
        <div className="row">
          <button type="submit" className="primary" disabled={state.saving || !form.name.trim()}>
            {state.saving ? 'Salvataggio…' : 'Aggiungi'}
          </button>
          {state.error && <span className="error-box">{state.error}</span>}
        </div>
      </form>
    </Modal>
  );
}

function Row({ p, statuses, kinds, specialtyLabel, onChange, onCheck, onRemove, onTailor }) {
  const [note, setNote] = useState(p.note ?? '');
  const [checking, setChecking] = useState(false);
  const where = [p.city, p.distanceKm != null ? `${p.distanceKm} km` : null].filter(Boolean).join(' · ');
  const sent = ['inviata', 'sollecitata', 'colloquio', 'rifiutata', 'nessuna_risposta'].includes(p.status);
  return (
    <article className="pub">
      <div className="main">
        <div className="title">
          {p.website ? (
            <a href={p.website} target="_blank" rel="noopener noreferrer">
              {p.name}
            </a>
          ) : (
            <span className="name">{p.name}</span>
          )}
          <span className="faint small">{kinds[p.kind] ?? p.kind}</span>
          {p.followUpDue && <span className="badge">Da sollecitare</span>}
        </div>
        {where && <div className="meta">{where}</div>}
        {p.pitch && <div className="small">Ruolo da proporre: {p.pitch}</div>}
        {p.specialties.length > 0 && (
          <div className="tags">
            {p.specialties.map((s) => (
              <span key={s} className="tag">
                {specialtyLabel(s)}
              </span>
            ))}
          </div>
        )}
        <div className="links small">
          {p.careersUrl ? (
            <a href={p.careersUrl} target="_blank" rel="noopener noreferrer">
              Lavora con noi <ExternalIcon size={12} />
            </a>
          ) : (
            p.checkedAt &&
            !p.checkProblem && <span className="faint">nessuna pagina «lavora con noi»: candidatura spontanea</span>
          )}
          {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
          {p.checkProblem && <span className="faint">sito non raggiungibile ({p.checkProblem})</span>}
        </div>
        <input
          type="text"
          aria-label={`Note su ${p.name}`}
          placeholder="Note (contatto, cosa hai inviato…)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={() => note !== (p.note ?? '') && onChange(p, { note })}
        />
      </div>
      <div className="track">
        <select
          aria-label={`Stato di ${p.name}`}
          value={p.status}
          onChange={(e) => onChange(p, { status: e.target.value })}
        >
          {Object.entries(statuses).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {sent && (
          <label className="field small">
            <span className="faint">Inviata il</span>
            <input
              type="date"
              value={p.sentAt ?? ''}
              onChange={(e) => onChange(p, { sentAt: e.target.value || null })}
            />
          </label>
        )}
        {p.followUpAt && (
          <span
            className={`small ${p.followUpDue ? '' : 'faint'}`}
            style={p.followUpDue ? { color: 'var(--accent-hover)' } : undefined}
          >
            Sollecito {p.followUpDue ? 'dal' : 'il'} {shortDate(p.followUpAt)}
          </span>
        )}
        {!sent && p.addedAt && <span className="faint small">Aggiunta {relativeDay(p.addedAt)}</span>}
      </div>
      <div className="actions">
        <button type="button" className="small" onClick={() => onTailor(p)}>
          CV su misura
        </button>
        {p.website && (
          <button
            type="button"
            className="small ghost"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              await onCheck(p);
              setChecking(false);
            }}
          >
            <RefreshIcon size={14} />
            {checking ? 'Controllo…' : 'Controlla sito'}
          </button>
        )}
        <button
          type="button"
          className="icon"
          onClick={() => onRemove(p)}
          aria-label={`Togli ${p.name}`}
          title="Togli dall'elenco"
        >
          <TrashIcon />
        </button>
      </div>
    </article>
  );
}

/** Novità della sorveglianza: annunci nuovi, avvisi di ricerca di personale, pagine comparse o cambiate. */
function WatchPanel({ initial, count, onChecked }) {
  const [watch, setWatch] = useState(initial);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [all, setAll] = useState(false);

  async function run() {
    setRunning(true);
    setOutcome(null);
    try {
      const data = await send('/api/publishers/watch', 'POST');
      setWatch({ events: data.events, checkedAt: data.checkedAt });
      setOutcome(data);
      onChecked?.();
    } catch (err) {
      setOutcome({ error: err.message });
    } finally {
      setRunning(false);
    }
  }

  const shown = all ? watch.events : watch.events.slice(0, 6);
  return (
    <section className="card stack" aria-labelledby="watch-title" style={{ gap: 12 }}>
      <div className="row">
        <h2 id="watch-title">Novità dalle aziende seguite</h2>
        <span className="spacer" />
        {watch.checkedAt && <span className="faint small">Ultimo controllo {relativeDay(watch.checkedAt)}</span>}
        <button type="button" className="small" onClick={run} disabled={running || !count}>
          <RefreshIcon size={14} />
          {running ? `Controllo ${count} aziende…` : 'Controlla ora'}
        </button>
      </div>
      {outcome?.error && <p className="error-box small">{outcome.error}</p>}
      {outcome && !outcome.error && (
        <p className="small muted">
          {outcome.firstTime
            ? `Controllate ${outcome.checked} aziende: istantanee salvate, le novità si vedranno dal prossimo controllo.`
            : `Controllate ${outcome.checked} aziende: ${outcome.found.length ? `${outcome.found.length} novità.` : 'nessuna novità.'}`}
          {outcome.problems.length > 0 && ` ${outcome.problems.length} siti non hanno risposto.`}
        </p>
      )}
      {watch.events.length === 0 ? (
        <p className="small muted">
          Ogni controllo guarda le pagine «lavora con noi» (o la home) delle aziende in elenco e segnala annunci nuovi,
          frasi come «cerchiamo» e pagine comparse o cambiate. La prima volta salva solo un&apos;istantanea. Con la
          GitHub Action il controllo avviene ogni giorno e le novità arrivano su Telegram o per email.
        </p>
      ) : (
        <ul className="events">
          {shown.map((e) => (
            <li key={`${e.at}-${e.publisherId}-${e.type}-${e.title ?? e.text ?? ''}`}>
              <span className={`event-mark ${e.relevant ? 'relevant' : e.type}`} aria-hidden="true">
                {e.relevant ? '★' : e.type === 'pagina-cambiata' ? '·' : '!'}
              </span>
              <span className="stack" style={{ gap: 2 }}>
                <span>
                  <strong>{e.name}</strong>: {e.description}
                </span>
                <span className="faint small">
                  {relativeDay(e.at)}
                  {e.url && (
                    <>
                      {' · '}
                      <a href={e.url} target="_blank" rel="noopener noreferrer">
                        apri la pagina
                      </a>
                    </>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {watch.events.length > 6 && (
        <button type="button" className="small ghost" onClick={() => setAll(!all)} style={{ alignSelf: 'flex-start' }}>
          {all ? 'Mostra meno' : `Mostra tutte (${watch.events.length})`}
        </button>
      )}
    </section>
  );
}

export default function PublishersBoard({
  initialItems,
  statuses,
  kinds,
  specialties,
  sectors,
  defaultPlace,
  initialStale = 0,
  initialWatch = { events: [], checkedAt: null },
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [sector, setSector] = useState('');
  const [modal, setModal] = useState(null); // 'discover' | 'add'
  const [tailor, setTailor] = useState(null);
  const [error, setError] = useState('');
  const closeModal = useCallback(() => setModal(null), []);
  const closeTailor = useCallback(() => setTailor(null), []);
  const specialtyLabel = (id) => specialties.find((s) => s.id === id)?.label ?? id;

  const replace = (p) => setItems((prev) => prev.map((i) => (i.id === p.id ? p : i)));
  async function change(p, patch) {
    setError('');
    try {
      replace(await send(`/api/publishers/${encodeURIComponent(p.id)}`, 'PUT', patch));
      router.refresh();
    } catch (err) {
      setError(err.message);
    }
  }
  async function check(p) {
    replace(await send(`/api/publishers/${encodeURIComponent(p.id)}/check`, 'POST'));
  }
  async function remove(p) {
    if (!confirm(`Togliere "${p.name}" dall'elenco?`)) return;
    await send(`/api/publishers/${encodeURIComponent(p.id)}`, 'DELETE');
    setItems((prev) => prev.filter((i) => i.id !== p.id));
    router.refresh();
  }
  function added(list) {
    setItems((prev) => [...list, ...prev]);
    setModal(null);
    router.refresh();
  }

  const counts = Object.fromEntries(
    GROUPS.map((g) => [g.id, g.statuses ? items.filter((p) => g.statuses.includes(p.status)).length : items.length]),
  );
  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group);
    const q = query.trim().toLowerCase();
    return items.filter(
      (p) =>
        (!g.statuses || g.statuses.includes(p.status)) &&
        (!specialty || p.specialties.includes(specialty)) &&
        (!sector || p.kind === sector) &&
        (!q || [p.name, p.city, p.note, p.description, p.email].join(' ').toLowerCase().includes(q)),
    );
  }, [items, group, query, specialty, sector]);
  const due = items.filter((p) => p.followUpDue).length;
  // Stessa regola di staleFromWikidata: voci di Wikidata senza sito mai toccate.
  const stale = items.filter(
    (p) => p.source === 'wikidata' && !p.website && p.status === 'da_valutare' && !p.note && p.history.length <= 1,
  ).length;
  async function cleanup() {
    const { removed } = await send('/api/publishers/cleanup', 'POST');
    setItems((prev) => prev.filter((p) => !removed.includes(p.id)));
    router.refresh();
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Case editrici e aziende affini</h1>
          <p>
            Case editrici, studi editoriali e aziende di settori affini (agenzie, tipografie, librerie…) a cui mandare
            una candidatura spontanea: trovale, aggiungile e segui a che punto sei.
          </p>
        </div>
        <div className="row">
          <button type="button" onClick={() => setModal('add')}>
            <PlusIcon />
            Aggiungi a mano
          </button>
          <button type="button" className="primary" onClick={() => setModal('discover')}>
            <SearchIcon />
            Cerca nuove
          </button>
        </div>
      </header>

      {due > 0 && (
        <div className="statusbar">
          <span className="when">
            <span className="dot" style={{ background: 'var(--accent)' }} />
            {due === 1 ? '1 candidatura da sollecitare' : `${due} candidature da sollecitare`}: sono passate tre
            settimane dall&apos;invio senza risposta.
          </span>
        </div>
      )}
      {initialStale > 0 && stale > 0 && (
        <div className="statusbar">
          <span>
            {stale} voci trovate su Wikidata senza sito e mai toccate: sono quasi sempre stampatori storici o editori
            non più attivi.
          </span>
          <button type="button" className="small" onClick={cleanup}>
            <TrashIcon size={14} />
            Toglile
          </button>
        </div>
      )}
      {error && <p className="error-box">{error}</p>}
      {items.length > 0 && (
        <WatchPanel
          initial={initialWatch}
          onChecked={async () => setItems((await send('/api/publishers', 'GET')).items)}
          count={items.filter((p) => p.website && !['scartata', 'rifiutata'].includes(p.status)).length}
        />
      )}

      {!items.length ? (
        <div className="empty">
          Nessuna azienda ancora. Premi «Cerca nuove» per trovare case editrici e aziende affini attorno alla tua città,
          o aggiungile a mano.
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Stato">
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={group === g.id}
                  onClick={() => setGroup(g.id)}
                >
                  {g.label} <span className="pill">{counts[g.id]}</span>
                </button>
              ))}
            </div>
            <div className="search">
              <SearchIcon />
              <label htmlFor="pq" className="sr-only">
                Filtra per testo
              </label>
              <input
                id="pq"
                type="search"
                placeholder="Filtra per nome, città, note…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className="sr-only" htmlFor="spec">
              Specializzazione
            </label>
            <select
              id="spec"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="">Tutte le specializzazioni</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="sector">
              Settore
            </label>
            <select id="sector" value={sector} onChange={(e) => setSector(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Tutti i settori</option>
              {Object.entries(kinds).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {shown.length === 0 ? (
            <div className="empty">Nessuna azienda con questi filtri.</div>
          ) : (
            <div className="jobs">
              <div className="pubs-head overline" aria-hidden="true">
                <span>Azienda</span>
                <span>Candidatura</span>
                <span />
              </div>
              {shown.map((p) => (
                <Row
                  key={p.id}
                  p={p}
                  statuses={statuses}
                  kinds={kinds}
                  specialtyLabel={specialtyLabel}
                  onChange={change}
                  onCheck={check}
                  onRemove={remove}
                  onTailor={(x) => setTailor({ publisher: x.id })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {modal === 'discover' && (
        <DiscoverModal
          defaultPlace={defaultPlace}
          kinds={kinds}
          sectors={sectors}
          specialtyLabel={specialtyLabel}
          onAdded={added}
          onClose={closeModal}
        />
      )}
      {modal === 'add' && <AddModal kinds={kinds} onAdded={added} onClose={closeModal} />}
      {tailor && <TailorModal target={tailor} onClose={closeTailor} />}
    </div>
  );
}
