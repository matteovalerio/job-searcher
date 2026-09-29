import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stateDir } from '../paths.js';
import { analyzeCv, findLanguages } from '../profiles/cv.js';
import { compileKeywords, normalize } from '../text.js';
import { CEFR, LANGUAGE_LEARN, MARKET_SKILLS } from './catalog.js';

/*
 * Analisi del mercato: cosa chiedono davvero gli annunci trovati per un profilo (competenze, strumenti, lingue,
 * esperienza, contratti, stipendi) e il confronto con il CV, con un piano per colmare le lacune.
 *
 * Le caratteristiche di ogni offerta vista si accumulano nel tempo in .job-searcher/market-<profilo>.json
 * (ultimi 180 giorni), così l'analisi non dipende da una sola ricerca.
 */

const KEEP_DAYS = 180;
const MAX_JOBS = 3000;
const DAY = 24 * 60 * 60 * 1000;

const skills = MARKET_SKILLS.map((s) => ({ ...s, re: compileKeywords(s.detect) }));

/** Livello di lingua (A1…C2) da come lo scrive un annuncio o un CV, oppure null. */
export function cefrLevel(text) {
  const t = normalize(text);
  const explicit = t.match(/\b([abc][12])\b/);
  if (explicit) return explicit[1].toUpperCase();
  if (/madrelingua|native|mother tongue|nativ/.test(t)) return 'C2';
  if (/ottim|fluent|fluenza|avanzat|advanced|eccellent|professional|proficien/.test(t)) return 'C1';
  if (/buon|good|intermedi/.test(t)) return 'B2';
  if (/scolastic|basic|base|elementar/.test(t)) return 'A2';
  return null;
}

/** Competenze del catalogo trovate in un testo. */
export function findSkills(text) {
  const norm = normalize(text);
  return skills.filter((s) => s.re.some(({ re }) => re.test(norm))).map((s) => s.id);
}

/** Caratteristiche di un'offerta utili all'analisi (senza il testo, che è lungo). */
export function jobFeatures(job) {
  const text = `${job.title ?? ''}\n${job.description ?? ''}`;
  const info = job.info ?? {};
  const salary = info.salary?.currency === 'EUR' ? info.salary : null;
  return {
    title: job.title,
    company: job.company ?? null,
    source: job.source ?? null,
    postedAt: job.postedAt ?? null,
    hasDescription: Boolean(job.description && job.description.length > 80),
    skills: findSkills(text),
    languages: findLanguages(text.toLowerCase())
      .filter((l) => l.name !== 'italiano')
      .map((l) => ({ name: l.name, level: cefrLevel(l.level) })),
    yearsRequired: info.yearsRequired ?? null,
    seniority: info.seniority ?? null,
    contracts: info.contracts ?? [],
    workTime: info.workTime ?? null,
    salary: salary ? { min: salary.annualMin ?? null, max: salary.annualMax ?? null } : null,
  };
}

const historyFile = (profileId) => stateDir(`market-${profileId}.json`);

export async function loadHistory(profileId) {
  try {
    return JSON.parse(await readFile(historyFile(profileId), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { jobs: {} };
  }
}

/** Aggiunge allo storico del profilo le offerte di una ricerca (quelle già note si aggiornano). */
export async function updateHistory(profileId, results, now = new Date()) {
  const history = await loadHistory(profileId);
  const seenAt = now.toISOString();
  for (const job of results.flatMap((r) => r.jobs)) {
    history.jobs[job.id] = { ...jobFeatures(job), firstSeen: history.jobs[job.id]?.firstSeen ?? seenAt, seenAt };
  }
  const limit = now.getTime() - KEEP_DAYS * DAY;
  const kept = Object.entries(history.jobs)
    .filter(([, j]) => new Date(j.seenAt).getTime() >= limit)
    .sort((a, b) => b[1].seenAt.localeCompare(a[1].seenAt))
    .slice(0, MAX_JOBS);
  history.jobs = Object.fromEntries(kept);
  await mkdir(path.dirname(historyFile(profileId)), { recursive: true });
  const tmp = `${historyFile(profileId)}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(history));
  await rename(tmp, historyFile(profileId));
  return history;
}

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const countBy = (values) => {
  const out = {};
  for (const v of values) if (v) out[v] = (out[v] ?? 0) + 1;
  return Object.entries(out)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
};

const priority = (share) => (share >= 0.3 ? 'alta' : share >= 0.15 ? 'media' : 'bassa');

/**
 * Analisi di un insieme di offerte (vedi jobFeatures), confrontata con il CV se c'è.
 * Si contano solo le offerte con una descrizione: dal solo titolo non si capisce cosa chiedono.
 */
export function analyzeMarket(features, cvText = '') {
  const withText = features.filter((f) => f.hasDescription);
  const total = withText.length;
  const cvSkills = new Set(cvText ? findSkills(cvText) : []);
  const cv = cvText ? analyzeCv(cvText) : null;
  const cvLanguages = Object.fromEntries(
    (cvText ? findLanguages(cvText.toLowerCase()) : []).map((l) => [l.name, cefrLevel(l.level) ?? 'B2']),
  );

  const skillStats = skills
    .map((s) => {
      const count = withText.filter((f) => f.skills.includes(s.id)).length;
      return {
        id: s.id,
        label: s.label,
        category: s.category,
        count,
        share: total ? count / total : 0,
        inCv: cvSkills.has(s.id),
        learn: s.learn,
        show: s.show,
      };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  const languageNames = [...new Set(withText.flatMap((f) => f.languages.map((l) => l.name)))];
  const languages = languageNames
    .map((name) => {
      const mentions = withText.flatMap((f) => f.languages.filter((l) => l.name === name));
      const levels = mentions.map((m) => m.level).filter(Boolean);
      const typical = levels.length ? CEFR[median(levels.map((l) => CEFR.indexOf(l)))] : null;
      return {
        name,
        count: mentions.length,
        share: total ? mentions.length / total : 0,
        levels: countBy(levels),
        typical,
        cvLevel: cvLanguages[name] ?? null,
      };
    })
    .sort((a, b) => b.count - a.count);

  const years = withText.map((f) => f.yearsRequired).filter((y) => y != null);
  const salaries = withText
    .map(
      (f) =>
        f.salary && (f.salary.min && f.salary.max ? (f.salary.min + f.salary.max) / 2 : (f.salary.min ?? f.salary.max)),
    )
    .filter((v) => v && v > 5000);

  const gaps = skillStats
    .filter((s) => !s.inCv && (s.count >= 2 || s.share >= 0.1) && cvText)
    .map((s) => ({ ...s, priority: priority(s.share) }));
  const languageGaps = languages
    .filter((l) => cvText && l.share >= 0.1)
    .filter((l) => !l.cvLevel || (l.typical && CEFR.indexOf(l.typical) > CEFR.indexOf(l.cvLevel)))
    .map((l) => ({
      ...l,
      priority: priority(l.share),
      learn: LANGUAGE_LEARN[l.name] ?? 'corsi e certificazioni riconosciute della lingua',
    }));

  return {
    total,
    withoutDescription: features.length - total,
    skills: skillStats,
    strengths: skillStats.filter((s) => s.inCv),
    gaps,
    languages,
    languageGaps,
    experience: {
      count: years.length,
      median: median(years),
      buckets: [
        { label: 'fino a 2 anni', count: years.filter((y) => y <= 2).length },
        { label: '3-5 anni', count: years.filter((y) => y >= 3 && y <= 5).length },
        { label: '6-9 anni', count: years.filter((y) => y >= 6 && y <= 9).length },
        { label: '10 anni o più', count: years.filter((y) => y >= 10).length },
      ],
      cvYears: cv?.years ?? null,
    },
    seniority: countBy(withText.map((f) => f.seniority)),
    contracts: countBy(withText.flatMap((f) => f.contracts)),
    workTime: countBy(withText.map((f) => f.workTime)),
    salary: salaries.length
      ? {
          count: salaries.length,
          min: Math.min(...salaries),
          median: median(salaries),
          max: Math.max(...salaries),
        }
      : null,
    hasCv: Boolean(cvText),
  };
}

const pct = (share) => `${Math.round(share * 100)}%`;
const euro = (n) => `${Math.round(n / 1000)}k €`;

/** Testo per claude.ai: dai dati dell'analisi un piano personale per colmare le lacune. */
export function buildMarketPrompt({ analysis, cvText = '', profileName = '' }) {
  const lines = (items) => items.map((i) => `- ${i}`).join('\n') || '- (nessuna)';
  const skillLine = (s) =>
    `${s.label}: ${s.count} annunci (${pct(s.share)})${s.inCv ? ', presente nel CV' : ', NON nel CV'}`;
  const e = analysis.experience;
  return `Aiutami a capire come rendermi più forte per il lavoro che cerco${profileName ? ` (${profileName})` : ''}. Ho analizzato ${analysis.total} annunci con la descrizione, trovati negli ultimi mesi: ecco cosa chiedono e come si confrontano con il mio CV.

${cvText ? `Il mio CV:\n\n<cv>\n${cvText.trim()}\n</cv>` : 'Il mio CV è allegato a questo messaggio.'}

COSA CHIEDONO GLI ANNUNCI
${lines(analysis.skills.slice(0, 20).map(skillLine))}

LINGUE
${lines(analysis.languages.map((l) => `${l.name}: ${l.count} annunci (${pct(l.share)})${l.typical ? `, livello tipico ${l.typical}` : ''}; nel mio CV: ${l.cvLevel ?? 'non indicata'}`))}

ESPERIENZA, CONTRATTI, STIPENDI
- Anni richiesti (mediana): ${e.median ?? 'non indicati'} su ${e.count} annunci che li indicano; i miei: ${e.cvYears ?? 'vedi CV'}
- Livelli: ${analysis.seniority.map((s) => `${s.value} ${s.count}`).join(', ') || 'non indicati'}
- Contratti: ${analysis.contracts.map((c) => `${c.value} ${c.count}`).join(', ') || 'non indicati'}
- Stipendi annui lordi indicati: ${analysis.salary ? `${analysis.salary.count} annunci, da ${euro(analysis.salary.min)} a ${euro(analysis.salary.max)}, mediana ${euro(analysis.salary.median)}` : 'quasi mai indicati'}

COSA TI CHIEDO
1. Quali delle lacune pesano davvero (requisiti che fanno scartare la candidatura) e quali sono solo "graditi"? Considera anche quanto spesso compaiono.
2. Un piano di 4-8 settimane per colmare le più importanti: cosa studiare o fare ogni settimana, con risorse concrete e possibilmente gratuite o economiche (in italiano quando esistono). Non inventare corsi, siti o certificazioni: se non sei sicuro che una risorsa esista, descrivi il tipo di risorsa.
3. Uno o due piccoli progetti da portfolio che dimostrino le competenze mancanti (per esempio impaginare un catalogo per un'associazione).
4. Come valorizzare nel CV le esperienze che ho già e che rispondono a queste richieste, anche se le ho chiamate in un altro modo.
5. Se il mio profilo è molto sopra o sotto quello che chiedono (esperienza, livello), dimmelo e suggerisci come orientare la ricerca.

Chiedimi quanto tempo e quanto budget ho a disposizione, se ti serve per il piano.
`;
}
