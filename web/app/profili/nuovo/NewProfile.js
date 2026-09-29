'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const toList = (text) =>
  text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const toText = (list = []) => list.join(', ');

/** Campo lista: si scrive separando con virgole. */
function ListField({ label, hint, value, onChange, rows = 2 }) {
  return (
    <label className="field">
      <span>{label}</span>
      {hint && <span className="muted small">{hint}</span>}
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

/** Caricamento del CV, comune alle due modalità. */
function CvUpload({ onAnalyzed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    onAnalyzed(data);
  }
  return (
    <div className="row">
      <label className="field">
        <span>CV in PDF (facoltativo)</span>
        <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => upload(e.target.files[0])} />
      </label>
      {busy && <span className="muted small">Lettura del CV…</span>}
      {error && <span className="error-box small">{error}</span>}
    </div>
  );
}

function Summary({ analysis }) {
  const langs = analysis.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ');
  return (
    <div className="card small stack">
      <strong>Dal CV ho ricavato</strong>
      <div>Aree: {analysis.families.map((f) => f.label).join(', ') || 'nessuna riconosciuta'}</div>
      <div>Esperienza: circa {analysis.years} anni</div>
      {analysis.education.length > 0 && (
        <div>Studi: {analysis.education.map((e) => (e.field ? `${e.level} in ${e.field}` : e.level)).join(', ')}</div>
      )}
      {langs && <div>Lingue: {langs}</div>}
      {analysis.skills.length > 0 && <div>Competenze: {analysis.skills.join(', ')}</div>}
      {analysis.city && <div>Città: {analysis.city}</div>}
      <div className="muted">Controlla e correggi le proposte qui sotto.</div>
    </div>
  );
}

function Guided({ options, cv, onCv, onSaved }) {
  const [name, setName] = useState('');
  const [families, setFamilies] = useState([]);
  const [years, setYears] = useState(0);
  const [lists, setLists] = useState({ keywords: '', related: '', exclude: '', boost: '', languages: 'italiano' });
  const [search, setSearch] = useState({ searchArea: '', searchRemote: '' });
  const [places, setPlaces] = useState('');
  const [radiusKm, setRadiusKm] = useState(30);
  const [remote, setRemote] = useState('europa');
  const [maxAgeDays, setMaxAgeDays] = useState(30);
  const [browserSources, setBrowserSources] = useState(false);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  function apply(suggestion, keepLanguages = false) {
    setLists((prev) => ({
      keywords: toText(suggestion.keywords),
      related: toText(suggestion.related),
      exclude: toText(suggestion.exclude),
      boost: toText(suggestion.boost),
      languages: keepLanguages ? prev.languages : toText(suggestion.languages),
    }));
    setSearch({ searchArea: toText(suggestion.searchArea), searchRemote: toText(suggestion.searchRemote) });
  }

  // Dati ricavati dal CV: si precompila il modulo.
  useEffect(() => {
    if (!cv) return;
    setFamilies(cv.families);
    setYears(cv.analysis.years);
    if (cv.analysis.city) setPlaces(cv.analysis.city);
    apply(cv.suggestion);
    const first = options?.families.find((f) => f.id === cv.families[0]);
    if (first) setName(`${first.label} - ${cv.analysis.city ?? 'remoto'}`);
  }, [cv]); // eslint-disable-line react-hooks/exhaustive-deps

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
      keywords: toList(lists.keywords),
      related: toList(lists.related),
      exclude: toList(lists.exclude),
      boost: toList(lists.boost),
      languages: toList(lists.languages),
      searchArea: toList(search.searchArea),
      searchRemote: toList(search.searchRemote),
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
  return (
    <div className="stack">
      <CvUpload onAnalyzed={onCv} />
      {cv && <Summary analysis={cv.analysis} />}

      <label className="field">
        <span>Nome del profilo</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="es. Redattrice - Padova"
        />
      </label>

      <div className="field">
        <span>Aree professionali</span>
        <span className="muted small">
          Scegliendo le aree, le liste qui sotto vengono proposte (e ricalcolate) di conseguenza.
        </span>
        <div className="checks">
          {options.families.map((f) => (
            <label key={f.id} className="small">
              <input type="checkbox" checked={families.includes(f.id)} onChange={() => toggleFamily(f.id)} /> {f.label}
            </label>
          ))}
        </div>
      </div>

      <label className="field narrow">
        <span>Anni di esperienza nel ruolo</span>
        <input
          type="number"
          min="0"
          value={years}
          onChange={(e) => setYears(e.target.value)}
          onBlur={() => families.length && recompute(families, years)}
        />
      </label>

      <ListField
        label="Parole chiave dei ruoli"
        hint="Un'offerta viene tenuta se il titolo ne contiene almeno una. Separale con virgole; «*» finale = prefisso."
        value={lists.keywords}
        onChange={(v) => setLists({ ...lists, keywords: v })}
        rows={3}
      />
      <ListField
        label="Ruoli affini"
        hint="Tengono l'offerta ma con meno punti."
        value={lists.related}
        onChange={(v) => setLists({ ...lists, related: v })}
      />
      <ListField
        label="Parole da escludere"
        hint="Se compaiono nel titolo l'offerta viene scartata."
        value={lists.exclude}
        onChange={(v) => setLists({ ...lists, exclude: v })}
      />
      <ListField
        label="Settori, aziende e competenze che alzano il punteggio"
        value={lists.boost}
        onChange={(v) => setLists({ ...lists, boost: v })}
        rows={3}
      />
      <ListField
        label="Lingue conosciute"
        hint="Le offerte che nel titolo chiedono altre lingue vengono scartate."
        value={lists.languages}
        onChange={(v) => setLists({ ...lists, languages: v })}
        rows={1}
      />

      <div className="row">
        <label className="field">
          <span>Città in cui cercare</span>
          <input
            type="text"
            value={places}
            onChange={(e) => setPlaces(e.target.value)}
            placeholder="es. Padova, Vicenza (vuoto = solo remoto)"
          />
        </label>
        <label className="field narrow">
          <span>Raggio (km)</span>
          <input type="number" min="1" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>Offerte full remote</span>
          <select value={remote} onChange={(e) => setRemote(e.target.value)}>
            <option value="no">no</option>
            {Object.entries(options.remoteScopes).map(([k, label]) => (
              <option key={k} value={k}>
                sì, {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field narrow">
          <span>Pubblicate negli ultimi giorni</span>
          <input type="number" min="1" value={maxAgeDays} onChange={(e) => setMaxAgeDays(e.target.value)} />
        </label>
      </div>
      <label className="small">
        <input type="checkbox" checked={browserSources} onChange={(e) => setBrowserSources(e.target.checked)} /> Cerca
        anche su Indeed e InfoJobs (si apre il browser; i loro termini d&apos;uso non consentono la lettura automatica)
      </label>
      <details>
        <summary>Ricerche fatte sui portali</summary>
        <p className="muted small">Proposte in base alle aree; di solito non serve cambiarle.</p>
        <ListField
          label="In zona"
          value={search.searchArea}
          onChange={(v) => setSearch({ ...search, searchArea: v })}
        />
        <ListField
          label="Full remote"
          value={search.searchRemote}
          onChange={(v) => setSearch({ ...search, searchRemote: v })}
        />
      </details>

      <div className="row">
        <button onClick={() => save()} disabled={saving || !name.trim() || !lists.keywords.trim()}>
          {saving ? 'Salvataggio…' : 'Crea il profilo'}
        </button>
        {message && <span className={message.error ? 'error-box' : 'ok-box'}>{message.text}</span>}
      </div>
    </div>
  );
}

function WithClaude({ cv, onCv, onSaved }) {
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function makePrompt() {
    const { data } = await post('/api/profiles/prompt', { cvText: cv?.cvText ?? '' });
    setPrompt(data.prompt);
    setCopied(false);
  }

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

  return (
    <div className="stack">
      <p className="muted small">
        Claude legge il CV, ti fa qualche domanda e scrive il profilo. Usa il tuo abbonamento su claude.ai: nessuna
        chiave API e nessun costo in più. Il CV, con i dati personali che contiene, viene inviato a claude.ai.
      </p>
      <CvUpload onAnalyzed={onCv} />
      <div className="row">
        <button onClick={makePrompt}>1. Prepara il testo da incollare</button>
        {cv ? (
          <span className="muted small">il testo del CV è incluso</span>
        ) : (
          <span className="muted small">senza CV: allegalo tu nella chat</span>
        )}
      </div>
      {prompt && (
        <>
          <textarea rows={10} readOnly value={prompt} />
          <div className="row">
            <button className="secondary" onClick={copy}>
              {copied ? 'Copiato ✓' : 'Copia'}
            </button>
            <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
              2. Apri claude.ai e incollalo
            </a>
          </div>
        </>
      )}
      <label className="field">
        <span>3. Incolla qui la risposta di Claude (con il blocco JSON)</span>
        <textarea rows={10} value={answer} onChange={(e) => setAnswer(e.target.value)} />
      </label>
      <div className="row">
        <button onClick={() => importAnswer()} disabled={saving || !answer.trim()}>
          {saving ? 'Salvataggio…' : '4. Salva il profilo'}
        </button>
        {error && <span className="error-box small">{error}</span>}
      </div>
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
    <div className="stack">
      <h1>Nuovo profilo</h1>
      <div className="tabs">
        <button className={mode === 'guided' ? 'active' : ''} onClick={() => setMode('guided')}>
          Procedura guidata
        </button>
        <button className={mode === 'claude' ? 'active' : ''} onClick={() => setMode('claude')}>
          Con l&apos;aiuto di Claude
        </button>
      </div>
      <div className="card">
        {mode === 'guided' ? (
          <Guided options={options} cv={cv} onCv={setCv} onSaved={onSaved} />
        ) : (
          <WithClaude cv={cv} onCv={setCv} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}
