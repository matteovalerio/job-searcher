'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { relativeDay, shortDate } from '../../lib/format.js';
import { ExternalIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon } from '../icons.js';
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

function DiscoverModal({ defaultPlace, kinds, specialtyLabel, onAdded, onClose }) {
  const [place, setPlace] = useState(defaultPlace || 'Padova');
  const [radiusKm, setRadiusKm] = useState(30);
  const [state, setState] = useState({});
  const [selected, setSelected] = useState(new Set());

  async function search(e) {
    e.preventDefault();
    setState({ loading: true });
    try {
      const data = await send('/api/publishers/discover', 'POST', { place, radiusKm });
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
    <Modal title="Cerca case editrici e studi editoriali" onClose={onClose} wide>
      <p className="small muted">
        Cerca su OpenStreetMap e Wikidata le realtà editoriali attorno a una città. Le mappe non sono complete: aggiungi
        a mano quelle che conosci. Poi «Controlla sito» ne ricava specializzazione, email e pagina «lavora con noi».
      </p>
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
        <button type="submit" className="primary" style={{ alignSelf: 'flex-end' }} disabled={state.loading}>
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
    </Modal>
  );
}

function AddModal({ kinds, onAdded, onClose }) {
  const [form, setForm] = useState({ name: '', website: '', city: '', kind: 'casa-editrice', email: '', note: '' });
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
    <Modal title="Aggiungi una casa editrice" onClose={onClose}>
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

export default function PublishersBoard({ initialItems, statuses, kinds, specialties, defaultPlace }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('');
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
        (!q || [p.name, p.city, p.note, p.description, p.email].join(' ').toLowerCase().includes(q)),
    );
  }, [items, group, query, specialty]);
  const due = items.filter((p) => p.followUpDue).length;

  return (
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Case editrici</h1>
          <p>
            Case editrici e studi editoriali a cui mandare una candidatura spontanea: trovale, aggiungile e segui a che
            punto sei.
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
      {error && <p className="error-box">{error}</p>}

      {!items.length ? (
        <div className="empty">
          Nessuna casa editrice ancora. Premi «Cerca nuove» per trovarne attorno alla tua città, o aggiungile a mano.
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
          </div>
          {shown.length === 0 ? (
            <div className="empty">Nessuna casa editrice con questi filtri.</div>
          ) : (
            <div className="jobs">
              <div className="pubs-head overline" aria-hidden="true">
                <span>Casa editrice</span>
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
