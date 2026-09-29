'use client';

import { useState } from 'react';

/** "Perché non trovo questa offerta?": diagnosi di un'offerta di LinkedIn per il profilo attivo. */
export default function WhyPanel({ profile }) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState({});

  async function check(e) {
    e.preventDefault();
    setState({});
    try {
      const res = await fetch('/api/why', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState({ data });
    } catch (err) {
      setState({ error: err.message });
    }
  }

  const { data } = state;
  return (
    <details className="card why">
      <summary>Un'offerta di LinkedIn non compare?</summary>
      <p className="small muted">
        Incolla il link: il programma prova le ricerche del profilo su LinkedIn e il filtro, e ti dice cosa cambiare. Ci
        vuole qualche decina di secondi.
      </p>
      <form className="row" onSubmit={check}>
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.linkedin.com/jobs/view/4470018594/"
          aria-label="Link dell'offerta di LinkedIn"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" className="primary">
          Controlla
        </button>
      </form>
      {state.error && <p className="error-box small">{state.error}</p>}
      {data && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            <strong>{data.job.title || '(titolo non trovato)'}</strong>
            <span className="muted"> · {[data.job.company, data.job.location].filter(Boolean).join(' · ')}</span>
          </p>
          {data.targets.map((t) => (
            <div key={t.target.id} className="stack" style={{ gap: 6 }}>
              <span className="overline">{t.target.label ?? t.target.id}</span>
              <ul className="kit-reqs">
                <li className={t.verdict.rejected ? 'gap' : 'ok'}>
                  <span className="req">
                    {t.verdict.rejected
                      ? `Il filtro la scarta: ${t.verdict.rejected}`
                      : `Il filtro la tiene (punteggio ${t.verdict.score})`}
                  </span>
                  {t.verdict.details.place && (
                    <span className="evidence">
                      Località «{data.job.location}»:{' '}
                      {t.verdict.details.place.ok ? 'in zona' : t.verdict.details.place.reason}
                    </span>
                  )}
                </li>
                <li className={t.search.found ? 'ok' : t.search.skipped ? '' : 'gap'}>
                  <span className="req">
                    {t.search.skipped ??
                      (t.search.found
                        ? `La ricerca «${t.search.found.keyword}» la trova (pagina ${t.search.found.page})`
                        : t.search.tried.length === 1
                          ? "L'unica ricerca del profilo non la trova"
                          : `Nessuna delle ${t.search.tried.length} ricerche del profilo la trova`)}
                  </span>
                  {t.search.byTitle && (
                    <span className="evidence">
                      Cercando il titolo «{t.search.byTitle.keyword}»:{' '}
                      {t.search.byTitle.found ? 'trovata' : 'non trovata'}
                    </span>
                  )}
                </li>
              </ul>
              {t.advice.length > 0 && (
                <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  {t.advice.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
