'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { shortDate } from '../../lib/format.js';
import KitModal from '../KitModal.js';

const pct = (x) => (x === null || x === undefined ? 'n.d.' : `${Math.round(x * 100)}%`);
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const dm = (day) => `${Number(day.slice(8))}/${Number(day.slice(5, 7))}`;

/** Obiettivo della settimana: misuratore a una serie (fatte su obiettivo). */
function Meter({ label, done, goal }) {
  const share = goal ? Math.min(1, done / goal) : 0;
  return (
    <div className="tile">
      <span className="overline">{label}</span>
      <span className="tile-value">
        {done}
        <span className="faint" style={{ fontSize: 18 }}>
          {' '}
          / {goal}
        </span>
      </span>
      <span className="bar-track" aria-hidden="true">
        <span className="bar-fill" style={{ width: `${Math.max(done ? 4 : 0, share * 100)}%` }} />
      </span>
      <span className="small muted">
        {done >= goal && goal > 0 ? 'Obiettivo raggiunto' : `Ne mancano ${Math.max(0, goal - done)}`}
      </span>
    </div>
  );
}

/** Candidature inviate nelle ultime 8 settimane: colonne a una serie, dettaglio al passaggio del mouse. */
function Weeks({ weeks }) {
  const max = Math.max(1, ...weeks.map((w) => w.applications + w.spontaneous));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ul className="week-bars" aria-label="Candidature inviate nelle ultime 8 settimane">
        {weeks.map((w, i) => {
          const total = w.applications + w.spontaneous;
          const label = `Settimana dal ${dm(w.start)}: ${n(total, 'candidatura', 'candidature')} (${w.applications} a offerte, ${w.spontaneous} spontanee)`;
          const current = i === weeks.length - 1;
          return (
            // biome-ignore lint/a11y/noNoninteractiveTabindex: la colonna si raggiunge da tastiera per leggere il dettaglio
            <li key={w.start} className="week-col" tabIndex={0} aria-label={label}>
              <span className="week-tip" role="tooltip">
                {label}
              </span>
              <span className="week-value">{current || total === max ? total : ''}</span>
              {total > 0 && <span className="week-bar" style={{ height: `${(total / max) * 100}%` }} />}
              <span className="week-label">{current ? 'questa' : dm(w.start)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatsTable({ title, rows }) {
  if (!rows.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="overline">{title}</span>
      <div className="table-wrap">
        <table className="stats">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Inviate</th>
              <th scope="col">Risposte</th>
              <th scope="col">Colloqui</th>
              <th scope="col">In attesa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td>{r.sent}</td>
                <td>
                  {r.responses} <span className="faint">· {pct(r.responseRate)}</span>
                </td>
                <td>
                  {r.interviews} <span className="faint">· {pct(r.interviewRate)}</span>
                </td>
                <td>{r.waiting}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Goals({ goals, onSaved }) {
  const [values, setValues] = useState(goals);
  const [error, setError] = useState('');
  const changed = values.applications !== goals.applications || values.spontaneous !== goals.spontaneous;
  async function save(e) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: values }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    onSaved(data);
  }
  const field = (key, label) => (
    <label className="row small" style={{ gap: 8 }}>
      <input
        type="number"
        min={0}
        max={100}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) }))}
        style={{ width: 72 }}
      />
      {label}
    </label>
  );
  return (
    <form className="row goals" onSubmit={save}>
      <span className="small muted">Obiettivi a settimana:</span>
      {field('applications', 'a offerte')}
      {field('spontaneous', 'spontanee')}
      <button type="submit" className="small" disabled={!changed}>
        Salva
      </button>
      {error && <span className="error-box small">{error}</span>}
    </form>
  );
}

export default function PlanView({ initialPlan }) {
  const router = useRouter();
  const [plan, setPlan] = useState(initialPlan);
  const [kit, setKit] = useState(null);
  const closeKit = useCallback(() => {
    setKit(null);
    // Dopo un sollecito o un invio i numeri cambiano.
    fetch('/api/plan')
      .then((r) => r.json())
      .then(setPlan)
      .catch(() => {});
    router.refresh();
  }, [router]);

  const { week, todo, stats, advice } = plan;
  const o = stats.overall;
  return (
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Piano</h1>
          <p>
            La settimana dal {shortDate(week.start)} al {shortDate(week.end)}: obiettivi, cose da fare e come sta
            andando.
          </p>
        </div>
      </header>

      <section className="stack">
        <Goals key={`${plan.goals.applications}-${plan.goals.spontaneous}`} goals={plan.goals} onSaved={setPlan} />
        <div className="tiles">
          <Meter label="Candidature a offerte" done={week.applications.done} goal={week.applications.goal} />
          <Meter label="Candidature spontanee" done={week.spontaneous.done} goal={week.spontaneous.goal} />
          <div className="tile">
            <span className="overline">Solleciti</span>
            <span className="tile-value">{week.followUps.done}</span>
            <span className="small muted">
              {todo.followUps.length ? `${todo.followUps.length} da fare` : 'Nessuno da fare'}
            </span>
          </div>
        </div>
        {advice.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>Da fare</h2>
        {!todo.followUps.length && !todo.toApply.length && !todo.toContact.length && (
          <p className="muted">
            Niente in sospeso. Cerca nuove <Link href="/">offerte</Link> o nuove{' '}
            <Link href="/case-editrici">aziende</Link>.
          </p>
        )}
        {todo.followUps.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="overline">Da sollecitare</span>
            <ul className="todo">
              {todo.followUps.map((f) => (
                <li key={`${f.kind}-${f.id}`}>
                  <span>
                    <strong>{f.title}</strong>
                    {f.company && f.company !== f.title && <span className="muted"> · {f.company}</span>}
                    <span className="faint small"> · inviata il {shortDate(f.sentAt)}</span>
                  </span>
                  {f.kind === 'offerta' ? (
                    <button type="button" className="small" onClick={() => setKit({ id: f.id, title: f.title })}>
                      Testo del sollecito
                    </button>
                  ) : (
                    <Link className="button small" href="/case-editrici">
                      Apri
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {todo.toApply.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="overline">Offerte interessanti a cui candidarsi</span>
            <ul className="todo">
              {todo.toApply.map((t) => (
                <li key={t.id}>
                  <span>
                    <strong>{t.title}</strong>
                    {t.company && <span className="muted"> · {t.company}</span>}
                  </span>
                  <button type="button" className="small" onClick={() => setKit({ id: t.id, title: t.title })}>
                    Kit candidatura
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {todo.toContact.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="overline">Aziende da contattare</span>
            <ul className="todo">
              {todo.toContact.map((t) => (
                <li key={t.id}>
                  <span>
                    <strong>{t.title}</strong>
                    {t.sector && <span className="muted"> · {t.sector}</span>}
                  </span>
                  <Link className="button small" href="/case-editrici">
                    Apri
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Come sta andando</h2>
        {!o.sent ? (
          <p className="muted">
            Nessuna candidatura inviata finora: i numeri compaiono dopo le prime. Segna le candidature come «inviate»
            nel kit o nelle pagine Candidature e Case editrici.
          </p>
        ) : (
          <>
            <div className="tiles">
              <div className="tile">
                <span className="overline">Inviate</span>
                <span className="tile-value">{o.sent}</span>
                <span className="small muted">{o.waiting} in attesa di risposta</span>
              </div>
              <div className="tile">
                <span className="overline">Risposte</span>
                <span className="tile-value">{pct(o.responseRate)}</span>
                <span className="small muted">
                  {n(o.responses, 'risposta', 'risposte')}
                  {o.medianDays !== null ? ` · in ${n(o.medianDays, 'giorno', 'giorni')} (mediana)` : ''}
                </span>
              </div>
              <div className="tile">
                <span className="overline">Colloqui</span>
                <span className="tile-value">{pct(o.interviewRate)}</span>
                <span className="small muted">{n(o.interviews, 'colloquio', 'colloqui')}</span>
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="overline">Candidature inviate, ultime 8 settimane</span>
              <Weeks weeks={stats.weeks} />
            </div>
            <StatsTable title="Per canale" rows={stats.byChannel} />
            <StatsTable title="Candidature spontanee per settore" rows={stats.bySector} />
            <p className="small faint" style={{ margin: 0 }}>
              Nei tassi contano le candidature inviate da almeno una settimana: prima è presto per una risposta.
            </p>
          </>
        )}
      </section>

      {kit && <KitModal job={kit.id} title={kit.title} onClose={closeKit} />}
    </div>
  );
}
