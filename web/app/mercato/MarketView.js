'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, CloseIcon, CopyIcon, ExternalIcon, SparkIcon, UploadIcon } from '../icons.js';
import Modal from '../Modal.js';

const pct = (share) => `${Math.round(share * 100)}%`;
const k = (n) => `${Math.round(n / 1000)}k €`;

/** Riga con barra orizzontale: una sola serie, un solo colore; il valore sta in testo accanto alla barra. */
function BarRow({ label, share, count, detail, status }) {
  return (
    <div className="bar-row" title={`${label}: ${count} annunci (${pct(share)})`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track" aria-hidden="true">
        <span className="bar-fill" style={{ width: `${Math.max(2, share * 100)}%` }} />
      </span>
      <span className="bar-value">
        {pct(share)} <span className="faint">· {count}</span>
      </span>
      {status !== undefined && (
        <span className={`cv-status ${status ? 'ok' : 'missing'}`}>
          {status ? <CheckIcon size={12} /> : <CloseIcon size={10} />}
          {status ? 'nel CV' : 'manca'}
        </span>
      )}
      {detail && <span className="bar-detail faint small">{detail}</span>}
    </div>
  );
}

function Tile({ label, value, note }) {
  return (
    <div className="tile">
      <span className="overline">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="faint small">{note}</span>}
    </div>
  );
}

function PromptModal({ onClose }) {
  const [state, setState] = useState({ loading: true });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch('/api/market/prompt', { method: 'POST' })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => setState(ok ? data : { error: data.error }));
  }, []);
  async function copy() {
    await navigator.clipboard.writeText(state.prompt);
    setCopied(true);
  }
  return (
    <Modal title="Piano personale con Claude" onClose={onClose} wide>
      <p className="small muted">
        Il testo contiene i dati di questa pagina e il tuo CV. Claude distingue i requisiti che fanno scartare la
        candidatura da quelli graditi, propone un piano di 4-8 settimane con risorse concrete e progetti da portfolio, e
        ti dice come valorizzare quello che sai già fare.
      </p>
      {state.loading && <p className="muted">Preparo il testo…</p>}
      {state.error && <p className="error-box">{state.error}</p>}
      {state.prompt && (
        <>
          <textarea className="code" readOnly rows={12} value={state.prompt} aria-label="Testo per Claude" />
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

function CvUpload() {
  const router = useRouter();
  const [state, setState] = useState({});
  async function upload(file) {
    if (!file) return;
    setState({ busy: true });
    const form = new FormData();
    form.append('cv', file);
    const res = await fetch('/api/cv', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) return setState({ error: data.error });
    router.refresh();
  }
  return (
    <label className="dropzone">
      <span className="icon-box">
        <UploadIcon />
      </span>
      <span className="text">
        <strong>Carica il CV in PDF per vedere le lacune</strong>
        <span className="muted small">
          {state.busy ? 'Lettura del CV…' : 'Il confronto con gli annunci mostra cosa ti manca e come colmarlo.'}
        </span>
        {state.error && <span className="error-box small">{state.error}</span>}
      </span>
      <input type="file" accept="application/pdf,.pdf" onChange={(e) => upload(e.target.files[0])} />
    </label>
  );
}

export default function MarketView({ name, analysis: a, found }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const closePrompt = useCallback(() => setShowPrompt(false), []);
  const gaps = [...a.gaps, ...a.languageGaps];
  const high = gaps.filter((g) => g.priority === 'alta').length;

  if (!a.total) {
    return (
      <div className="page">
        <h1>Analisi del mercato</h1>
        <div className="empty">
          {found
            ? `Le ${found} offerte trovate per «${name}» non hanno una descrizione abbastanza lunga da analizzare. Serve qualche ricerca in più.`
            : `Nessuna offerta ancora per «${name}»: lancia una ricerca dalla pagina Offerte.`}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Analisi del mercato</h1>
          <p>
            Cosa chiedono i {a.total} annunci trovati per «{name}» negli ultimi mesi
            {a.hasCv ? ', confrontati con il tuo CV' : ''}. Le offerte si accumulano a ogni ricerca: più ricerche, più
            affidabili i numeri.
          </p>
        </div>
        {a.total > 0 && (
          <button type="button" className="primary" onClick={() => setShowPrompt(true)}>
            <SparkIcon />
            Piano personale con Claude
          </button>
        )}
      </header>

      <div className="tiles">
        <Tile
          label="Annunci analizzati"
          value={a.total}
          note={a.withoutDescription ? `${a.withoutDescription} senza descrizione esclusi` : null}
        />
        <Tile
          label="Esperienza richiesta"
          value={a.experience.median != null ? `${a.experience.median} anni` : 'n.d.'}
          note={
            a.experience.count
              ? `mediana su ${a.experience.count} annunci${a.experience.cvYears != null ? ` · tu: circa ${a.experience.cvYears}` : ''}`
              : 'quasi mai indicata'
          }
        />
        <Tile
          label="Stipendio annuo lordo"
          value={a.salary ? k(a.salary.median) : 'n.d.'}
          note={
            a.salary
              ? `mediana su ${a.salary.count} annunci · ${k(a.salary.min)}–${k(a.salary.max)}`
              : 'quasi mai indicato'
          }
        />
        {a.hasCv && <Tile label="Lacune da colmare" value={gaps.length} note={`${high} a priorità alta`} />}
      </div>

      {!a.hasCv && <CvUpload />}

      <section className="card stack" aria-labelledby="req-title">
        <h2 id="req-title">Cosa chiedono gli annunci</h2>
        <p className="small muted">Percentuale degli annunci che nominano ogni competenza o strumento.</p>
        <div className="bars">
          {a.skills.slice(0, 18).map((s) => (
            <BarRow key={s.id} label={s.label} share={s.share} count={s.count} status={a.hasCv ? s.inCv : undefined} />
          ))}
        </div>
      </section>

      <div className="grid-2 even" style={{ alignItems: 'start' }}>
        <section className="card stack" aria-labelledby="lang-title">
          <h2 id="lang-title">Lingue</h2>
          {a.languages.length ? (
            <div className="bars">
              {a.languages.map((l) => (
                <BarRow
                  key={l.name}
                  label={l.name}
                  share={l.share}
                  count={l.count}
                  detail={[l.typical && `di solito ${l.typical}`, a.hasCv && `tu: ${l.cvLevel ?? 'non indicata'}`]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </div>
          ) : (
            <p className="small muted">Gli annunci non chiedono lingue straniere.</p>
          )}
        </section>
        <section className="card stack" aria-labelledby="exp-title">
          <h2 id="exp-title">Esperienza e contratti</h2>
          {a.experience.count > 0 && (
            <div className="bars">
              {a.experience.buckets.map((b) => (
                <BarRow key={b.label} label={b.label} share={b.count / a.experience.count} count={b.count} />
              ))}
            </div>
          )}
          {a.contracts.length > 0 && (
            <p className="small muted">Contratti: {a.contracts.map((c) => `${c.value} ${c.count}`).join(', ')}</p>
          )}
          {a.seniority.length > 0 && (
            <p className="small muted">Livelli: {a.seniority.map((c) => `${c.value} ${c.count}`).join(', ')}</p>
          )}
        </section>
      </div>

      {a.hasCv && (
        <section className="card stack" aria-labelledby="gaps-title">
          <div className="row">
            <h2 id="gaps-title">Come colmare le lacune</h2>
            <span className="spacer" />
            <span className="faint small">priorità in base a quanto spesso sono richieste</span>
          </div>
          {gaps.length === 0 ? (
            <p className="small muted">Nessuna lacuna evidente rispetto agli annunci trovati.</p>
          ) : (
            <div className="gaps">
              {a.gaps.map((g) => (
                <article key={g.id} className="gap">
                  <div className="row">
                    <strong>{g.label}</strong>
                    <span className={`badge ${g.priority === 'alta' ? '' : 'warn'}`}>priorità {g.priority}</span>
                    <span className="faint small">{pct(g.share)} degli annunci</span>
                  </div>
                  <ul>
                    {g.learn.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  <p className="small">
                    <span className="faint">Nel CV:</span> {g.show}
                  </p>
                </article>
              ))}
              {a.languageGaps.map((l) => (
                <article key={l.name} className="gap">
                  <div className="row">
                    <strong>
                      {l.name} {l.typical ?? ''}
                    </strong>
                    <span className={`badge ${l.priority === 'alta' ? '' : 'warn'}`}>priorità {l.priority}</span>
                    <span className="faint small">
                      {pct(l.share)} degli annunci · nel CV: {l.cvLevel ?? 'non indicata'}
                    </span>
                  </div>
                  <ul>
                    <li>{l.learn}</li>
                  </ul>
                </article>
              ))}
            </div>
          )}
          {a.strengths.length > 0 && (
            <p className="small muted">
              <strong style={{ color: 'var(--fg-2)', fontWeight: 500 }}>Punti di forza già nel CV:</strong>{' '}
              {a.strengths.map((s) => s.label).join(', ')}.
            </p>
          )}
        </section>
      )}

      {showPrompt && <PromptModal onClose={closePrompt} />}
    </div>
  );
}
