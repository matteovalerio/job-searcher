'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { CheckIcon, CloseIcon, CopyIcon, ExternalIcon, ShieldIcon, SparkIcon, UploadIcon } from '../../icons.js';

const toList = (text) =>
  text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

/** Elenco di parole modificabile: Invio o virgola aggiungono, la × toglie. */
function TagInput({ label, hint, tone = '', value, onChange }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = (text) => {
    const words = toList(text).filter((w) => !value.includes(w));
    if (words.length) onChange([...value, ...words]);
    setDraft('');
  };
  return (
    <div className="field">
      <div className="field-head">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className={`tag-input ${tone}`}>
        {value.map((word) => (
          <span key={word} className="chip">
            {word}
            <button
              type="button"
              aria-label={`Togli «${word}» da ${label}`}
              onClick={() => onChange(value.filter((w) => w !== word))}
            >
              <CloseIcon />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          placeholder="Aggiungi…"
          value={draft}
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (/[,\n]/.test(text)) {
              e.preventDefault();
              add(draft + text);
            }
          }}
        />
      </div>
    </div>
  );
}

/** Caricamento del CV, comune alle due modalità: si sceglie il file o lo si trascina. */
function CvDrop({ cv, onAnalyzed, hint }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('cv', file);
    const res = await fetch('/api/profiles/analyze', { method: 'POST', body: form });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error);
    onAnalyzed({ ...data, fileName: file.name });
  }
  const status = busy ? 'Lettura del CV…' : cv ? `Caricato: ${cv.fileName}` : hint;
  return (
    <>
      <label
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files[0]);
        }}
      >
        <span className="icon-box">
          <UploadIcon />
        </span>
        <span className="text">
          <strong>
            {cv ? 'Carica un altro CV' : 'Carica il CV in PDF'} <span className="faint">· facoltativo</span>
          </strong>
          <span className="muted small">{status}</span>
        </span>
        <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => upload(e.target.files[0])} />
      </label>
      {error && <p className="error-box small">{error}</p>}
    </>
  );
}

function CvSummary({ analysis }) {
  const langs = analysis.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ');
  const rows = [
    ['Aree', analysis.families.map((f) => f.label).join(', ') || 'nessuna riconosciuta'],
    ['Esperienza', `circa ${analysis.years} anni`],
    ['Studi', analysis.education.map((e) => (e.field ? `${e.level} in ${e.field}` : e.level)).join(', ')],
    ['Lingue', langs],
    ['Competenze', analysis.skills.join(', ')],
    ['Città', analysis.city],
  ].filter(([, v]) => v);
  return (
    <dl className="cv-summary" aria-label="Dal CV ho ricavato">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionHead({ num, title, children }) {
  return (
    <div className="section-head">
      <div className="title">
        <span className="num">{num}</span>
        <h2>{title}</h2>
      </div>
      {children && <p>{children}</p>}
    </div>
  );
}

function Guided({ options, cv, onCv, onSaved }) {
  const [name, setName] = useState('');
  const [families, setFamilies] = useState([]);
  const [years, setYears] = useState(0);
  const [lists, setLists] = useState({ keywords: [], related: [], exclude: [], boost: [], languages: ['italiano'] });
  const [search, setSearch] = useState({ searchArea: [], searchRemote: [] });
  const [places, setPlaces] = useState('');
  const [radiusKm, setRadiusKm] = useState(30);
  const [remote, setRemote] = useState('europa');
  const [maxAgeDays, setMaxAgeDays] = useState(30);
  const [browserSources, setBrowserSources] = useState(false);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  function apply(suggestion, keepLanguages = false) {
    setLists((prev) => ({
      keywords: suggestion.keywords ?? [],
      related: suggestion.related ?? [],
      exclude: suggestion.exclude ?? [],
      boost: suggestion.boost ?? [],
      languages: keepLanguages ? prev.languages : (suggestion.languages ?? []),
    }));
    setSearch({ searchArea: suggestion.searchArea ?? [], searchRemote: suggestion.searchRemote ?? [] });
  }

  // Dati ricavati dal CV: si precompila il modulo, solo quando arriva un nuovo CV.
  // biome-ignore lint/correctness/useExhaustiveDependencies: non deve ripartire quando cambiano le opzioni
  useEffect(() => {
    if (!cv) return;
    setFamilies(cv.families);
    setYears(cv.analysis.years);
    if (cv.analysis.city) setPlaces(cv.analysis.city);
    apply(cv.suggestion);
    const first = options?.families.find((f) => f.id === cv.families[0]);
    if (first) setName(`${first.label} - ${cv.analysis.city ?? 'remoto'}`);
  }, [cv]);

  // Cambiando aree o esperienza si ricalcolano le liste (le lingue restano quelle scritte).
  async function recompute(nextFamilies, nextYears) {
    const { data } = await post('/api/profiles/suggest', {
      families: nextFamilies,
      years: Number(nextYears) || 0,
      skills: cv?.analysis.skills ?? [],
      languages: cv?.analysis.languages ?? [],
    });
    apply(data, true);
  }

  function toggleFamily(id) {
    const next = families.includes(id) ? families.filter((f) => f !== id) : [...families, id];
    setFamilies(next);
    recompute(next, years);
  }

  async function save(overwrite = false) {
    setSaving(true);
    setMessage(null);
    const answers = {
      name,
      years,
      areaLabels: options.families.filter((f) => families.includes(f.id)).map((f) => f.label),
      ...lists,
      ...search,
      places: toList(places),
      radiusKm,
      remote,
      maxAgeDays,
      browserSources,
      candidate: cv ? { education: cv.analysis.education, skills: cv.analysis.skills } : undefined,
    };
    const { ok, status, data } = await post('/api/profiles', { mode: 'form', answers, overwrite });
    setSaving(false);
    if (status === 409 && confirm(`${data.error}. Vuoi sostituirlo?`)) return save(true);
    if (!ok) return setMessage({ error: true, text: data.error });
    onSaved(data.id);
  }

  if (!options) return <p className="muted">Caricamento…</p>;
  const setList = (key) => (value) => setLists({ ...lists, [key]: value });
  const missing = !name.trim() || !lists.keywords.length;
  return (
    <>
      <div className="with-aside">
        <form className="stack" style={{ gap: 20 }} onSubmit={(e) => e.preventDefault()}>
          <section className="section">
            <SectionHead num="01" title="Chi sei" />
            <CvDrop cv={cv} onAnalyzed={onCv} hint="Servirà a suggerire aree e parole chiave." />
            {cv && <CvSummary analysis={cv.analysis} />}
            <div className="grid-2 even">
              <label className="field">
                <span className="label">Nome del profilo</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="es. Redattrice - Padova"
                />
              </label>
              <label className="field">
                <span className="label">Anni di esperienza</span>
                <input
                  type="number"
                  min="0"
                  value={years}
                  onChange={(e) => setYears(e.target.value)}
                  onBlur={() => families.length && recompute(families, years)}
                />
              </label>
            </div>
          </section>

          <section className="section">
            <SectionHead num="02" title="Aree professionali">
              Le parole chiave qui sotto vengono proposte (e ricalcolate) in base alle aree scelte.
            </SectionHead>
            <div className="chips">
              {options.families.map((f) => {
                const on = families.includes(f.id);
                return (
                  <button key={f.id} type="button" aria-pressed={on} onClick={() => toggleFamily(f.id)}>
                    {on && <CheckIcon />}
                    {f.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="section">
            <SectionHead num="03" title="Cosa cercare" />
            <TagInput
              label="Parole chiave dei ruoli"
              hint="Almeno una nel titolo"
              tone="green"
              value={lists.keywords}
              onChange={setList('keywords')}
            />
            <TagInput
              label="Ruoli affini"
              hint="Meno punti"
              tone="blue"
              value={lists.related}
              onChange={setList('related')}
            />
            <TagInput
              label="Parole da escludere"
              hint="Scartano l'offerta"
              value={lists.exclude}
              onChange={setList('exclude')}
            />
            <TagInput
              label="Settori, aziende e competenze"
              hint="Alzano il punteggio"
              tone="accent"
              value={lists.boost}
              onChange={setList('boost')}
            />
            <TagInput
              label="Lingue conosciute"
              hint="Altre lingue nel titolo = scartata"
              value={lists.languages}
              onChange={setList('languages')}
            />
          </section>

          <section className="section">
            <SectionHead num="04" title="Dove e quando" />
            <div className="grid-2">
              <label className="field">
                <span className="label">Città in cui cercare</span>
                <input
                  type="text"
                  value={places}
                  onChange={(e) => setPlaces(e.target.value)}
                  placeholder="es. Padova, Vicenza — vuoto = solo remoto"
                />
              </label>
              <label className="field">
                <span className="label">Raggio</span>
                <span className="with-unit">
                  <input type="number" min="1" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
                  <span>km</span>
                </span>
              </label>
            </div>
            <div className="grid-2">
              <label className="field">
                <span className="label">Offerte full remote</span>
                <select value={remote} onChange={(e) => setRemote(e.target.value)}>
                  {Object.entries(options.remoteScopes).map(([k, label]) => (
                    <option key={k} value={k}>
                      Sì, {label}
                    </option>
                  ))}
                  <option value="no">No</option>
                </select>
              </label>
              <label className="field">
                <span className="label">Pubblicate negli ultimi</span>
                <span className="with-unit">
                  <input type="number" min="1" value={maxAgeDays} onChange={(e) => setMaxAgeDays(e.target.value)} />
                  <span>giorni</span>
                </span>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={browserSources} onChange={(e) => setBrowserSources(e.target.checked)} />
              <span>
                <strong>Cerca anche su Indeed e InfoJobs</strong>
                <span className="muted small">
                  Si apre il browser: i loro termini d&apos;uso non consentono la lettura automatica.
                </span>
              </span>
            </label>
            <details>
              <summary>Ricerche fatte sui portali</summary>
              <div className="stack" style={{ marginTop: 16 }}>
                <p className="muted small">Proposte in base alle aree; di solito non serve cambiarle.</p>
                <TagInput
                  label="In zona"
                  value={search.searchArea}
                  onChange={(v) => setSearch({ ...search, searchArea: v })}
                />
                <TagInput
                  label="Full remote"
                  value={search.searchRemote}
                  onChange={(v) => setSearch({ ...search, searchRemote: v })}
                />
              </div>
            </details>
          </section>
        </form>

        <aside className="card stack">
          <h3>Come vengono filtrate le offerte</h3>
          <div className="legend">
            <div>
              <span className="dot" style={{ background: 'var(--green)' }} />
              <span>
                <strong>Parole chiave</strong> — l&apos;offerta resta se il titolo ne contiene almeno una.
              </span>
            </div>
            <div>
              <span className="dot" style={{ background: 'var(--blue)' }} />
              <span>
                <strong>Ruoli affini</strong> — la tengono, ma con meno punti.
              </span>
            </div>
            <div>
              <span className="dot" style={{ background: 'var(--accent)' }} />
              <span>
                <strong>Settori e competenze</strong> — alzano il punteggio.
              </span>
            </div>
            <div>
              <span className="dot" />
              <span>
                <strong>Esclusioni e lingue</strong> — scartano l&apos;offerta.
              </span>
            </div>
          </div>
          <div className="faint" style={{ fontSize: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            Un «*» finale fa da prefisso: <code style={{ color: 'var(--fg-2)' }}>redatt*</code>
          </div>
        </aside>
      </div>

      <div className="save-bar">
        {message && <span className={message.error ? 'error-box' : 'ok-box'}>{message.text}</span>}
        {missing && !message && <span className="faint small">Servono un nome e almeno una parola chiave.</span>}
        <Link href="/profili" className="button">
          Annulla
        </Link>
        <button type="button" className="primary" onClick={() => save()} disabled={saving || missing}>
          {saving ? 'Salvataggio…' : 'Salva profilo'}
        </button>
      </div>
    </>
  );
}

function StepNum({ n, state }) {
  return <span className={`step-num ${state}`}>{state === 'done' ? <CheckIcon /> : n}</span>;
}

function WithClaude({ cv, onCv, onSaved }) {
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Il testo si rifà quando cambia il CV, così lo include.
  useEffect(() => {
    setCopied(false);
    post('/api/profiles/prompt', { cvText: cv?.cvText ?? '' }).then(({ data }) => setPrompt(data.prompt));
  }, [cv]);

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
  }

  async function importAnswer(overwrite = false) {
    setSaving(true);
    setError('');
    const { ok, status, data } = await post('/api/profiles', { mode: 'import', text: answer, overwrite });
    setSaving(false);
    if (status === 409 && confirm(`${data.error}. Vuoi sostituirlo?`)) return importAnswer(true);
    if (!ok)
      return setError(`${data.error} — puoi incollare questo errore nella chat e chiedere a Claude di correggere.`);
    onSaved(data.id);
  }

  // Passo attuale: il CV è facoltativo, poi copia, risposta, salvataggio.
  const current = !copied ? 2 : !answer.trim() ? 3 : 4;
  const state = (n) => {
    if (n === 1) return cv ? 'done' : '';
    return n < current ? 'done' : n === current ? 'current' : '';
  };
  return (
    <div className="with-aside">
      <ol className="steps">
        <li>
          <div className="rail">
            <StepNum n={1} state={state(1)} />
          </div>
          <div className="body">
            <div>
              <h2>
                Aggiungi il CV <span className="faint small">· facoltativo</span>
              </h2>
              <p>Senza CV puoi allegarlo direttamente nella chat.</p>
            </div>
            <CvDrop cv={cv} onAnalyzed={onCv} hint="Trascina qui il PDF o scegli un file." />
          </div>
        </li>
        <li>
          <div className="rail">
            <StepNum n={2} state={state(2)} />
          </div>
          <div className="body">
            <div>
              <h2>Copia il testo e incollalo su claude.ai</h2>
              <p>
                Claude legge il CV, ti fa qualche domanda e scrive il profilo.{' '}
                {cv ? 'Il testo del CV è già incluso.' : 'Ricordati di allegare il CV nella chat.'}
              </p>
            </div>
            <div className="row">
              <button type="button" className="primary" onClick={copy} disabled={!prompt}>
                <CopyIcon />
                {copied ? 'Copiato' : 'Copia il testo'}
              </button>
              <a className="button" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
                Apri claude.ai <ExternalIcon />
              </a>
            </div>
            {prompt && (
              <details>
                <summary>Mostra il testo</summary>
                <textarea
                  className="code"
                  readOnly
                  rows={10}
                  value={prompt}
                  aria-label="Testo da incollare"
                  style={{ marginTop: 12 }}
                />
              </details>
            )}
          </div>
        </li>
        <li>
          <div className="rail">
            <StepNum n={3} state={state(3)} />
          </div>
          <div className="body">
            <div>
              <h2>Incolla qui la risposta di Claude</h2>
              <p>Va bene anche tutta la risposta: basta che contenga il blocco JSON.</p>
            </div>
            <label htmlFor="claude-answer" className="sr-only">
              Risposta di Claude
            </label>
            <textarea
              id="claude-answer"
              className="code"
              rows={9}
              placeholder={'```json\n{ "name": "…", "keywords": [ … ] }\n```'}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>
        </li>
        <li>
          <div className="rail">
            <StepNum n={4} state={state(4)} />
          </div>
          <div className="body">
            <h2>Salva il profilo</h2>
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => importAnswer()}
                disabled={saving || !answer.trim()}
              >
                {saving ? 'Salvataggio…' : 'Salva il profilo'}
              </button>
            </div>
            {error && <p className="error-box small">{error}</p>}
          </div>
        </li>
      </ol>
      <aside className="card stack">
        <div className="row">
          <span style={{ color: 'var(--blue)', display: 'flex' }}>
            <ShieldIcon />
          </span>
          <h3>Nessun costo in più</h3>
        </div>
        <p className="muted small" style={{ lineHeight: 1.6 }}>
          Usa il tuo abbonamento su claude.ai: niente chiave API. Il CV, con i dati personali che contiene, viene
          inviato a claude.ai.
        </p>
      </aside>
    </div>
  );
}

export default function NewProfile() {
  const router = useRouter();
  const [mode, setMode] = useState('guided');
  const [options, setOptions] = useState(null);
  const [cv, setCv] = useState(null);

  useEffect(() => {
    fetch('/api/profiles/suggest')
      .then((r) => r.json())
      .then(setOptions);
  }, []);

  const onSaved = (id) => router.push(`/?profile=${id}`);
  return (
    <div className="page">
      <header className="stack" style={{ gap: 20 }}>
        <Link href="/profili" className="back">
          ← Profili
        </Link>
        <h1>Nuovo profilo</h1>
        <div className="segmented" role="tablist" aria-label="Modalità">
          <button type="button" role="tab" aria-selected={mode === 'guided'} onClick={() => setMode('guided')}>
            Procedura guidata
          </button>
          <button type="button" role="tab" aria-selected={mode === 'claude'} onClick={() => setMode('claude')}>
            <SparkIcon size={15} />
            Con l&apos;aiuto di Claude
          </button>
        </div>
      </header>
      {mode === 'guided' ? (
        <Guided options={options} cv={cv} onCv={setCv} onSaved={onSaved} />
      ) : (
        <WithClaude cv={cv} onCv={setCv} onSaved={onSaved} />
      )}
    </div>
  );
}
