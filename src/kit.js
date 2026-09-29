import { yearsRequired } from './extract.js';
import { MARKET_SKILLS } from './market/catalog.js';
import { findSkills } from './market/index.js';
import { analyzeCv, findLanguages } from './profiles/cv.js';
import { extractJson } from './profiles/prompt.js';
import { bestContact } from './publishers/people.js';
import { PUBLISHER_KINDS } from './publishers/specialties.js';
import { emphasisFor } from './tailor.js';
import { normalize } from './text.js';

/*
 * Kit di candidatura per un'offerta: che cosa cerca l'azienda, che cosa del CV risponde, un CV riordinato,
 * l'email di candidatura e quella di sollecito.
 *
 * Due strade, come nel resto del programma:
 *   1. lo strumento interno (qui), senza intelligenza artificiale: non scrive frasi nuove sul candidato,
 *      sceglie e riordina quelle del CV. Ogni riga del CV proposto viene dal CV vero.
 *   2. il prompt per Claude, con le stesse informazioni e l'analisi interna; la risposta (un blocco ```json)
 *      si importa e il programma segnala quello che non trova nel CV (numeri, strumenti, contatti).
 *
 * Non si inventa mai nulla: quello che l'annuncio chiede e il CV non mostra finisce tra le "lacune", da
 * affrontare con onestà (o da aggiungere al CV se è vero), non nel testo della candidatura.
 */

// Intestazioni delle parti di un annuncio (testo in minuscolo, accenti compresi).
// biome-ignore format: elenco più leggibile così
const OFFER_HEADINGS = {
  requirements: ['requisiti( richiesti)?', 'cosa cerchiamo', 'chi cerchiamo', 'profilo ricercato', 'profilo richiesto', "il candidato ideale", 'la candidata ideale', 'la persona ideale', 'competenze richieste', 'competenze', 'titoli preferenziali', 'costituisce titolo preferenziale', 'qualifications', 'requirements', "what we're looking for", 'what we are looking for', 'about you', 'who you are', 'you have', 'must have', 'nice to have', 'skills'],
  tasks: ['mansioni', 'responsabilit[aà]', 'attivit[aà]', 'di cosa ti occuperai', 'cosa farai', 'la risorsa si occuper[aà]', 'la figura si occuper[aà]', 'compiti', 'responsibilities', "what you'll do", 'what you will do', 'the role', 'your role', 'key tasks'],
  offer: ['offriamo', 'cosa offriamo', 'si offre', 'we offer', 'what we offer', 'benefits', 'inquadramento', 'sede di lavoro'],
  company: ['chi siamo', 'about us', "l'azienda", 'la societ[aà]', 'about the company', 'il nostro cliente', 'our client'],
};
const HEADING_RE = new RegExp(
  `(^|\\n|[.!?]\\s)\\s*(${Object.values(OFFER_HEADINGS).flat().join('|')})\\s*(:|\\n|-|–|•)`,
  'gi',
);
const kindOfHeading = (text) =>
  Object.entries(OFFER_HEADINGS).find(([, list]) =>
    list.some((h) => new RegExp(`^(${h})$`, 'i').test(text.trim())),
  )?.[0];

// Frasi che, anche senza intestazioni, di solito sono requisiti.
const REQUIREMENT_CUE =
  /(richiest|necessari|indispensabil|preferenzial|gradit|esperienza|conoscenza|capacit[aà]|laurea|diploma|padronanza|ottim[oa]|buon[oa] |required|preferred|experience|knowledge|degree|fluent|proficien|ability to|familiarity)/i;

/** Divide un pezzo di annuncio in punti: righe, elenchi puntati, punti e virgola, frasi. */
function items(text) {
  return text
    .split(/\n|•|·|▪|●|‣|;|(?<=[a-zà-ù0-9)])\.\s+(?=[A-ZÀ-Ù])/)
    .map((s) => s.replace(/^[\s\-–*]+/, '').trim())
    .filter((s) => s.length >= 12 && s.length <= 260);
}

/**
 * Le parti di un annuncio: requisiti, mansioni, cosa offrono e chi sono.
 * @returns {{ requirements: string[], tasks: string[], offer: string[], company: string[], language: 'it'|'en' }}
 */
export function analyzeOfferText(text = '') {
  const out = { requirements: [], tasks: [], offer: [], company: [] };
  const marks = [...text.matchAll(HEADING_RE)].map((m) => ({
    kind: kindOfHeading(m[2]),
    start: m.index + m[0].length,
    at: m.index + m[1].length,
  }));
  for (const [i, mark] of marks.entries()) {
    if (!mark.kind) continue;
    const end = marks[i + 1]?.at ?? text.length;
    out[mark.kind].push(...items(text.slice(mark.start, end)));
  }
  // Senza intestazioni: le frasi che hanno l'aria di requisiti.
  if (!out.requirements.length) out.requirements = items(text).filter((s) => REQUIREMENT_CUE.test(s));
  const unique = (list) => [...new Set(list)].slice(0, 15);
  return {
    requirements: unique(out.requirements),
    tasks: unique(out.tasks),
    offer: unique(out.offer),
    company: unique(out.company),
    language: offerLanguage(text),
  };
}

/** Lingua dell'annuncio: inglese o italiano (quella dell'email e del CV). */
export function offerLanguage(text = '') {
  const t = ` ${normalize(text)} `;
  const count = (words) => words.reduce((n, w) => n + t.split(` ${w} `).length - 1, 0);
  return count(['the', 'and', 'you', 'with', 'our', 'will', 'for', 'of', 'we', 'to', 'are', 'is', 'as']) >
    count(['il', 'la', 'di', 'per', 'con', 'che', 'della', 'del', 'e', 'un', 'una', 'sono', 'si', 'nel', 'le', 'gli'])
    ? 'en'
    : 'it';
}

/* Confronto tra testo dell'annuncio e CV. */

// biome-ignore format: elenco di parole
const STOP = new Set(['della', 'delle', 'degli', 'dello', 'nella', 'nelle', 'negli', 'sono', 'essere', 'avere', 'anche', 'come', 'molto', 'ottima', 'ottimo', 'buona', 'buono', 'capacita', 'conoscenza', 'esperienza', 'richiesta', 'richiesto', 'preferibile', 'preferibilmente', 'titolo', 'preferenziale', 'almeno', 'anni', 'with', 'from', 'your', 'have', 'will', 'that', 'this', 'about', 'experience', 'knowledge', 'ability', 'strong', 'skills', 'good', 'excellent', 'years', 'nostro', 'nostra', 'vostro', 'lavoro', 'lavorare', 'attivita', 'gestione', 'ambito', 'settore', 'ruolo', 'figura', 'risorsa', 'candidato', 'candidata', 'lingua', 'lingue', 'language', 'conoscenze', 'utilizzo']);

/** Radici delle parole significative di un testo ("revisione", "revisioni" → "revisi"). */
function stems(text) {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.slice(0, 6)),
  );
}

const skillIds = (text) => new Set(findSkills(text));

const languageNames = (text) => new Set(findLanguages(normalize(text)).map((l) => l.name));

/** Quanto una frase del CV risponde a un requisito (0 = per niente). */
function relevance(requirement, cvItem) {
  let score = 0;
  for (const s of cvItem.stems) if (requirement.stems.has(s)) score++;
  for (const id of cvItem.skills) if (requirement.skills.has(id)) score += 2;
  for (const l of cvItem.languages) if (requirement.languages.has(l)) score += 2;
  return score;
}

/* Il CV, diviso in parti (con il testo originale, maiuscole comprese). */

const CV_HEADING =
  /^(profilo( professionale)?|sommario|summary|profile|chi sono|esperienz[ae]( professional[ei]| lavorativ[ae])?|work experience|professional experience|experience|employment|istruzione( e formazione)?|formazione|titoli di studio|education|lingue|conoscenze linguistiche|languages|competenze( tecniche| informatiche| digitali| personali)?|skills|capacit[aà].*|certificazioni|certifications|pubblicazioni|publications|progetti|projects|interessi|interests|riferimenti|references|dati personali|altre informazioni|volontariato)$/;
const DATE_LINE = /(^|\s)((0?[1-9]|1[0-2])[/.-])?(19|20)\d{2}\b/;

function sectionKind(heading) {
  const h = normalize(heading);
  if (/^(profilo|sommario|summary|profile|chi sono)/.test(h)) return 'profile';
  if (/^(esperienz|work|professional|experience|employment)/.test(h)) return 'experience';
  if (/^(istruzione|formazione|titoli|education)/.test(h)) return 'education';
  if (/^(competenze|skills|capacit)/.test(h)) return 'skills';
  if (/^(lingue|conoscenze linguistiche|languages)/.test(h)) return 'languages';
  return 'other';
}

/**
 * Il CV in parti: intestazione (nome e contatti), sezioni e, nelle esperienze, le singole voci con i loro punti.
 * @returns {{ header: string[], sections: { heading, kind, lines: string[], entries?: { title, points }[] }[] }}
 */
export function parseCv(text = '') {
  const header = [];
  const sections = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const bare = normalize(line).replace(/[:.]$/, '');
    if (bare.length <= 45 && CV_HEADING.test(bare)) {
      sections.push({ heading: line.replace(/:$/, ''), kind: sectionKind(bare), lines: [] });
      continue;
    }
    if (sections.length) sections.at(-1).lines.push(line);
    else header.push(line);
  }
  for (const s of sections) {
    if (s.kind !== 'experience' && s.kind !== 'education') continue;
    // Una voce comincia con una riga che contiene una data ("03/2020 - oggi Redattrice - …").
    s.entries = [];
    for (const line of s.lines) {
      if (DATE_LINE.test(line) || !s.entries.length) s.entries.push({ title: line, body: [] });
      else s.entries.at(-1).body.push(line);
    }
    for (const e of s.entries) {
      e.points = joinContinuations(e.body).flatMap(splitPoints);
      delete e.body;
    }
  }
  return { header, sections };
}

/** Punti di una riga: separati da ";" o da elenchi puntati. */
function splitPoints(line) {
  return line
    .split(/;\s*|•|·|▪|●/)
    .map((p) => p.replace(/^[\s\-–*]+/, '').trim())
    .filter(Boolean);
}

/** Riunisce le righe che continuano quella precedente (il PDF va a capo): cominciano in minuscolo. */
function joinContinuations(lines) {
  const out = [];
  for (const line of lines) {
    if (out.length && /^[a-zà-ù]/.test(line.replace(/^[\s\-–*•]+/, ''))) out[out.length - 1] += ` ${line}`;
    else out.push(line);
  }
  return out;
}

/** Nome e contatti dal CV (prime righe). */
export function cvContacts(text = '') {
  const email = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] ?? null;
  const phone = text.match(/(\+\d{2}\s?)?\d{3}[\s.]?\d{3,4}[\s.]?\d{3,4}/)?.[0]?.trim() ?? null;
  const first = text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  const name = first && /^[\p{L}' -]{4,50}$/u.test(first) && first.split(/\s+/).length <= 4 ? first : null;
  return { name, email, phone };
}

const rank = (item) => (item.section === 'experience' ? (item.title ? 1 : 0) : 2);

/**
 * Confronto tra l'annuncio e il CV: per ogni requisito, le frasi del CV che lo mostrano (testo originale).
 * @returns {{ covered: { requirement, evidence: string[] }[], missing: string[], points: Map, skills }}
 */
export function matchCv(cvText, offer, job = {}) {
  const cv = parseCv(cvText);
  const cvItems = [];
  for (const s of cv.sections) {
    if (s.entries) {
      for (const e of s.entries) {
        // Anche la riga del titolo conta: ruolo, azienda, titolo di studio.
        cvItems.push({ text: e.title, section: s.kind, title: true });
        for (const p of e.points) cvItems.push({ text: p, section: s.kind, entry: e.title });
      }
    } else {
      for (const line of joinContinuations(s.lines)) {
        for (const p of splitPoints(line)) cvItems.push({ text: p, section: s.kind });
      }
    }
  }
  for (const item of cvItems) {
    item.skills = skillIds(item.text);
    item.stems = stems(item.text);
    item.languages = languageNames(item.text);
  }

  // Requisiti e mansioni: le mansioni dicono che cosa si farà davvero. Senza nessuno dei due, il titolo.
  const texts = [...offer.requirements, ...offer.tasks];
  if (!texts.length && job.title) texts.push(job.title);
  const taskSet = new Set(offer.tasks);
  const cvYears = cvText ? analyzeCv(cvText).years : null;
  const requirements = texts.map((text) => ({
    text,
    task: taskSet.has(text) && !offer.requirements.includes(text),
    years: yearsRequired(normalize(text)),
    skills: skillIds(text),
    stems: stems(text),
    languages: languageNames(text),
  }));
  const covered = [];
  const missing = [];
  const pointScore = new Map();
  for (const r of requirements) {
    // Requisiti brevi ("esperienza in redazione") bastano con una parola in comune.
    const needed = Math.min(2, Math.max(1, r.stems.size));
    const scored = cvItems
      .map((item) => ({ item, score: relevance(r, item) }))
      .filter((x) => x.score >= needed)
      // A parità di punteggio, meglio un punto di un'esperienza che un elenco di competenze.
      .sort((a, b) => b.score - a.score || rank(a.item) - rank(b.item));
    for (const { item, score } of scored) pointScore.set(item.text, (pointScore.get(item.text) ?? 0) + score);
    // Anni chiesti e anni del CV: se non bastano si dice (la frase trovata non basta a coprire il requisito).
    const note =
      r.years && cvYears != null && cvYears < r.years
        ? `Il CV mostra circa ${cvYears} anni di esperienza, l'annuncio ne chiede ${r.years}.`
        : null;
    if (scored.length) {
      covered.push({
        requirement: r.text,
        task: r.task,
        evidence: scored.slice(0, 2).map((x) => x.item.text),
        highlight: scored.find((x) => x.item.section === 'experience' && !x.item.title)?.item.text ?? null,
        ...(note ? { note } : {}),
      });
    } else missing.push(r.text);
  }

  // Strumenti e competenze chiesti dall'annuncio: presenti o no nel CV.
  const offerSkills = findSkills([job.title, job.description, ...texts].join('\n'));
  const cvSkills = new Set(findSkills(cvText));
  const label = (id) => MARKET_SKILLS.find((s) => s.id === id)?.label ?? id;
  const skills = {
    matched: offerSkills.filter((id) => cvSkills.has(id)).map(label),
    missing: offerSkills.filter((id) => !cvSkills.has(id)).map(label),
  };
  // Lingue chieste dall'annuncio e non nel CV.
  const cvLanguages = new Set(findLanguages(cvText.toLowerCase()).map((l) => l.name));
  const languages = findLanguages(`${job.description ?? ''} ${texts.join(' ')}`.toLowerCase())
    .filter((l) => l.name !== 'italiano')
    .map((l) => ({ name: l.name, inCv: cvLanguages.has(l.name) }));
  return { cv, covered, missing, pointScore, skills, languages };
}

/* CV riordinato: solo righe del CV vero. */

const HEADINGS = {
  it: { key: 'COMPETENZE CHIAVE' },
  en: { key: 'KEY SKILLS' },
};

/**
 * CV adattato senza scrivere nulla di nuovo: in ogni esperienza vengono prima i punti che rispondono
 * all'annuncio; una sezione "Competenze chiave" riprende (parola per parola) le frasi del CV più pertinenti;
 * le competenze chieste vanno in cima. L'ordine delle esperienze (cronologico) non cambia.
 * @returns {{ text: string, changes: string[] }}
 */
export function buildCvDraft(match, { language = 'it' } = {}) {
  const { cv, covered, pointScore } = match;
  const score = (p) => pointScore.get(p) ?? 0;
  const changes = [];
  const out = [...cv.header, ''];

  // Solo punti delle esperienze: competenze e lingue hanno già la loro sezione.
  const key = [...new Set(covered.map((c) => c.highlight).filter(Boolean))].slice(0, 5);
  const profile = cv.sections.find((s) => s.kind === 'profile');
  if (profile) out.push(profile.heading.toUpperCase(), ...profile.lines, '');
  if (key.length) {
    out.push(HEADINGS[language].key, ...key.map((k) => `- ${k}`), '');
    changes.push(
      `Aggiunta la sezione «${HEADINGS[language].key}» con ${key.length === 1 ? 'una frase presa' : `${key.length} frasi prese`} dal CV che ${key.length === 1 ? 'risponde' : 'rispondono'} all'annuncio.`,
    );
  }
  for (const s of cv.sections) {
    if (s === profile) continue;
    out.push(s.heading.toUpperCase());
    if (s.entries) {
      for (const e of s.entries) {
        const sorted = [...e.points].sort((a, b) => score(b) - score(a));
        if (sorted.some((p, i) => p !== e.points[i]) && score(sorted[0]) > 0) {
          changes.push(`«${clip(e.title, 60)}»: prima i punti che rispondono all'annuncio.`);
        }
        out.push(e.title, ...sorted.map((p) => `- ${p}`));
        if (s.kind === 'experience' && e.points.length && e.points.every((p) => !score(p))) {
          changes.push(`«${clip(e.title, 60)}» non risponde a nessun requisito: se serve spazio, accorciala.`);
        }
      }
    } else if (s.kind === 'skills') {
      // Competenze: prima quelle che l'annuncio chiede (le voci separate da virgole restano le stesse).
      const list = s.lines.flatMap((l) => l.split(/,\s*|;\s*/)).map((x) => x.replace(/\.$/, '').trim());
      const asked = new Set(findSkills(covered.map((c) => c.requirement).join('\n')));
      const sorted = [...list].sort(
        (a, b) => Number(findSkills(b).some((id) => asked.has(id))) - Number(findSkills(a).some((id) => asked.has(id))),
      );
      if (sorted.some((x, i) => x !== list[i])) changes.push('Competenze riordinate: prima quelle chieste.');
      out.push(`${sorted.join(', ')}.`);
    } else {
      out.push(...s.lines);
    }
    out.push('');
  }
  return { text: out.join('\n').trim(), changes };
}

const clip = (text, max) => {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
};

/* Email di candidatura e di sollecito. */

// biome-ignore format: tabella
const SOURCE_LABELS = { linkedin: 'LinkedIn', infojobs: 'InfoJobs', jooble: 'Jooble', adzuna: 'Adzuna', remotive: 'Remotive', remoteok: 'Remote OK', himalayas: 'Himalayas', jobicy: 'Jobicy', inpa: 'inPA' };

/** Nome dell'azienda senza la forma societaria ("Edizioni Rosse S.r.l." → "Edizioni Rosse"). */
export function companyName(name) {
  return String(name ?? '')
    .replace(
      /[\s,]+(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|ltd\.?|gmbh|inc\.?|llc)\.?$/i,
      '',
    )
    .trim();
}

function signature(contacts) {
  return [contacts.name, contacts.phone, contacts.email].filter(Boolean).join('\n');
}

/** Saluto e forma di cortesia: a una persona ("Gentile Anna De Luca, le scrivo") o all'azienda ("vi scrivo"). */
function salutation(company, job, language) {
  const who = companyName(company.name ?? job.company) || null;
  const person = company.contact?.name;
  if (language === 'en') return { dear: `Dear ${person ?? (who ? `${who} team` : 'Hiring Manager')},` };
  return {
    dear: `Gentile ${person ?? (who ? `team di ${who}` : 'Responsabile della selezione')},`,
    write: person ? 'le scrivo' : 'vi scrivo',
    attached: person ? 'In allegato trova il mio CV' : 'In allegato trovate il mio CV',
  };
}

/**
 * Email di candidatura (oggetto e testo). Le attività citate sono frasi del CV, non riscritte.
 * @returns {{ to: string|null, subject: string, body: string }}
 */
export function buildEmail({ job, company = {}, match, contacts = {}, language = 'it' }) {
  const highlights = [...new Set(match.covered.map((c) => c.highlight).filter(Boolean))]
    .slice(0, 3)
    .map((h) => h.replace(/[.;]$/, ''));
  const hello = salutation(company, job, language);
  const to = company.contact?.email ?? company.email ?? null;
  const where = SOURCE_LABELS[job.source];
  if (language === 'en') {
    return {
      to,
      subject: `Application for ${job.title}${contacts.name ? ` – ${contacts.name}` : ''}`,
      body: [
        hello.dear,
        '',
        `I am writing to apply for the ${job.title} position${where ? ` I found on ${where}` : ''}.`,
        highlights.length
          ? `Among the work I have done, these are the closest to what you are looking for:\n${highlights.map((h) => `- ${h}`).join('\n')}`
          : null,
        '',
        'Please find my CV attached. I would be glad to discuss my application in an interview, also online.',
        '',
        'Kind regards,',
        signature(contacts),
      ]
        .filter((l) => l !== null)
        .join('\n')
        .trim(),
    };
  }
  return {
    to,
    subject: `Candidatura per la posizione di ${job.title}${contacts.name ? ` – ${contacts.name}` : ''}`,
    body: [
      hello.dear,
      '',
      `${hello.write} per candidarmi alla posizione di ${job.title}${where ? ` che ho visto su ${where}` : ''}.`,
      highlights.length
        ? `Tra le attività che ho svolto, quelle più vicine a ciò che cercate sono:\n${highlights.map((h) => `- ${h}`).join('\n')}`
        : null,
      '',
      `${hello.attached}. Sarei felice di approfondire in un colloquio, anche online.`,
      '',
      'Cordiali saluti,',
      signature(contacts),
    ]
      .filter((l) => l !== null)
      .join('\n')
      .trim(),
  };
}

/** Email di sollecito, da mandare se non rispondono (vedi i solleciti in tracking.js). */
export function buildFollowUp({ job, company = {}, contacts = {}, sentAt = null, language = 'it' }) {
  const hello = salutation(company, job, language);
  const date = sentAt ? new Date(sentAt).toLocaleDateString(language === 'en' ? 'en-GB' : 'it-IT') : null;
  if (language === 'en') {
    return {
      subject: `Follow-up: application for ${job.title}`,
      body: [
        hello.dear,
        '',
        `I am following up on my application for the ${job.title} position${date ? `, sent on ${date}` : ''}.`,
        'I am still very interested in the role and happy to provide any further information or to arrange an interview.',
        '',
        'Thank you for your time.',
        '',
        'Kind regards,',
        signature(contacts),
      ]
        .join('\n')
        .trim(),
    };
  }
  return {
    subject: `Sollecito: candidatura per ${job.title}`,
    body: [
      hello.dear,
      '',
      `${hello.write} per sapere se ci sono novità sulla mia candidatura alla posizione di ${job.title}${date ? `, inviata il ${date}` : ''}.`,
      'La posizione mi interessa ancora molto e resto a disposizione per un colloquio o per qualsiasi informazione.',
      '',
      'Grazie per l’attenzione.',
      '',
      'Cordiali saluti,',
      signature(contacts),
    ]
      .join('\n')
      .trim(),
  };
}

/* L'azienda. */

// Siti che pubblicano annunci di altri: il loro dominio non è quello dell'azienda.
const PORTALS =
  /(^|\.)(linkedin|indeed|infojobs|adzuna|jooble|glassdoor|monster|remotive|remoteok|himalayas|jobicy|weworkremotely|inpa|google|subito|bakeca|trovit|careerjet|talent|helplavoro|lavoro|workday|myworkdayjobs|greenhouse|lever|smartrecruiters|recruitee|teamtailor|personio)\./;

/** Sito dell'azienda ricavabile dall'annuncio (se l'annuncio è sul sito dell'azienda), oppure null. */
export function companySiteFromJob(job) {
  try {
    const url = new URL(job.url);
    return PORTALS.test(url.host.toLowerCase()) ? null : `${url.origin}/`;
  } catch {
    return null;
  }
}

/** L'azienda nell'elenco delle case editrici e aziende seguite (stesso nome), oppure null. */
export function findCompany(job, publishers = []) {
  const name = normalize(job.company ?? '')
    .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|spa|srl|ltd|gmbh|inc)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (name.length < 3) return null;
  return (
    publishers.find((p) => {
      const n = normalize(p.name)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      return n === name || (n.length >= 5 && (n.includes(name) || name.includes(n)));
    }) ?? null
  );
}

/**
 * Tutto il kit con lo strumento interno.
 * @param {{ job, text?, cvText, publishers?, site? }} options  text: il testo completo dell'annuncio, se
 *   l'utente lo incolla (molti portali ne danno solo un pezzo); site: quello che si sa del sito dell'azienda
 */
export function buildKit({ job, text, cvText = '', publishers = [], site = null }) {
  const offerText = text?.trim() || job.description || '';
  const offer = analyzeOfferText(offerText);
  const known = findCompany(job, publishers);
  const company = {
    name: job.company ?? known?.name ?? null,
    website: known?.website ?? site?.website ?? companySiteFromJob(job),
    email: known?.email ?? site?.email ?? null,
    careersUrl: known?.careersUrl ?? site?.careersUrl ?? null,
    kind: known?.kind ?? null,
    kindLabel: known?.kind ? (PUBLISHER_KINDS[known.kind] ?? null) : null,
    specialties: known?.specialties ?? site?.specialties ?? [],
    description: known?.description ?? site?.description ?? null,
    about: offer.company,
    known: Boolean(known),
    // La persona a cui scrivere, se è stata trovata sul sito (vedi people.js).
    contact: bestContact(known?.people),
  };
  const emphasis = emphasisFor({
    specialties: company.specialties,
    kind: company.kind,
    text: [job.title, job.company, offerText].join(' '),
  });
  const match = matchCv(cvText, offer, { ...job, description: offerText });
  const contacts = cvContacts(cvText);
  const cv = cvText ? buildCvDraft(match, { language: offer.language }) : null;
  return {
    job: { id: job.id, title: job.title, company: job.company, url: job.url, source: job.source },
    offerText,
    shortText: offerText.length < 400,
    language: offer.language,
    offer,
    company,
    emphasis,
    covered: match.covered,
    missing: match.missing,
    skills: match.skills,
    languages: match.languages,
    cv,
    email: buildEmail({ job, company, match, contacts, language: offer.language }),
    followUp: buildFollowUp({ job, company, contacts, language: offer.language }),
    hasCv: Boolean(cvText),
  };
}

/* Prompt per Claude e import della risposta. */

/** Testo da incollare su claude.ai: CV, annuncio, azienda e analisi interna; risposta in un blocco ```json. */
export function buildKitPrompt(kit, cvText = '') {
  const list = (items) => items.map((i) => `- ${i}`).join('\n');
  const c = kit.company;
  const company = [
    c.name && `- Nome: ${c.name}${c.kindLabel ? ` (${c.kindLabel})` : ''}`,
    c.website && `- Sito: ${c.website}`,
    c.contact && `- Persona a cui scrivere (dal sito): ${c.contact.name}, ${c.contact.role}`,
    c.specialties?.length && `- Specializzazioni riconosciute dal sito: ${c.specialties.join(', ')}`,
    c.description && `- Come si descrive: ${clip(c.description, 500)}`,
    kit.offer.company.length && `- Dall'annuncio: ${clip(kit.offer.company.join(' '), 500)}`,
  ]
    .filter(Boolean)
    .join('\n');
  const covered = kit.covered.map((x) => `- ${x.requirement}\n  nel CV: «${x.evidence.join('» / «')}»`).join('\n');
  return `Preparami il kit per candidarmi a questa offerta: capire cosa cerca l'azienda, adattare il CV e scrivere l'email.

<cv>
${cvText.trim() || '(il CV è allegato a questo messaggio)'}
</cv>

<annuncio>
Ruolo: ${kit.job.title}
${kit.job.company ? `Azienda: ${kit.job.company}\n` : ''}${kit.job.url ? `Link: ${kit.job.url}\n` : ''}
${kit.offerText.trim().slice(0, 6000) || '(testo non disponibile: se puoi, apri il link)'}
</annuncio>

L'AZIENDA
${company || '- Non so altro: se puoi, cerca informazioni sul sito ufficiale e dimmi da dove le prendi.'}

LA MIA ANALISI (automatica, da verificare)
Requisiti che il CV mostra:
${covered || '- nessuno riconosciuto'}
Requisiti che non trovo nel CV:
${kit.missing.length ? list(kit.missing) : '- nessuno'}
${kit.emphasis.focus.length ? `Da valorizzare per questo tipo di azienda:\n${list(kit.emphasis.focus)}\n` : ''}
REGOLE (importantissime)
1. Non inventare MAI nulla: niente esperienze, ruoli, date, numeri, strumenti, titoli di studio, lingue o risultati che non siano nel CV. Puoi scegliere, riordinare, accorciare e riformulare quello che c'è.
2. Fai emergere le esperienze vere che rispondono all'annuncio, anche se nel CV sono in secondo piano, usando le parole dell'annuncio quando descrivono la stessa cosa.
3. I requisiti che il CV non mostra NON vanno scritti nel CV né nell'email. Elencali tra le lacune, con un consiglio onesto su come affrontarli (per esempio al colloquio).
4. Se per valorizzare un punto ti manca un'informazione, fammi una domanda invece di supporla.
5. Lingua: ${kit.language === 'en' ? 'inglese' : 'italiano'}, come l'annuncio. Tono concreto, niente aggettivi vuoti.

COSA TI CHIEDO
Rispondi con un unico blocco \`\`\`json, con questi campi:
{
  "azienda": "chi è l'azienda e cosa cerca davvero con questo annuncio (3-5 righe, dicendo cosa deduci)",
  "requisiti": [{ "requisito": "…", "nel_cv": "frase del CV che lo dimostra, copiata, oppure null" }],
  "lacune": [{ "requisito": "…", "consiglio": "come affrontarlo onestamente" }],
  "cv": "il CV adattato, completo, in testo semplice (titoli in maiuscolo, punti con il trattino), massimo due pagine",
  "modifiche": ["cosa hai cambiato nel CV e perché"],
  "email": { "oggetto": "…", "testo": "email di candidatura, massimo 180 parole, con saluti e firma" },
  "sollecito": { "oggetto": "…", "testo": "email di sollecito cortese da mandare dopo una settimana senza risposta" },
  "domande": ["informazioni che ti mancano per fare meglio"]
}
`;
}

// Sigle comuni che non dicono niente di nuovo sul candidato.
const COMMON_ACRONYMS = new Set(['CV', 'PDF', 'IT', 'EU', 'UE', 'HR', 'OK', 'RAL', 'CEO', 'SRL', 'SPA']);

const numbersIn = (text) => new Set(String(text).match(/\d+(?:[.,]\d+)?%?/g) ?? []);

/**
 * Controlla la risposta di Claude: segnala quello che il CV e l'annuncio non contengono (numeri, strumenti,
 * lingue, contatti). Non corregge: chi legge decide.
 * @returns {string[]}
 */
export function checkInvented(text, cvText, offerText = '') {
  const warnings = [];
  const source = `${cvText}\n${offerText}`;
  const known = numbersIn(source);
  const extra = [...numbersIn(text)].filter((n) => !known.has(n) && !/^[0-9]$/.test(n));
  if (extra.length) warnings.push(`Numeri che non trovo nel CV né nell'annuncio: ${extra.slice(0, 8).join(', ')}.`);
  const cvSkills = new Set(findSkills(cvText));
  const newSkills = findSkills(text).filter((id) => !cvSkills.has(id));
  if (newSkills.length) {
    const label = (id) => MARKET_SKILLS.find((s) => s.id === id)?.label ?? id;
    warnings.push(`Competenze o strumenti che non sono nel tuo CV: ${newSkills.map(label).join(', ')}.`);
  }
  // Nomi di strumenti e prodotti fuori dal catalogo: parole come "QuarkXPress" o sigle come "SEO".
  const lowerSource = source.toLowerCase();
  const names = [...new Set(text.match(/\b(?:[A-Za-z]*[a-z][A-Z][A-Za-z]*|[A-Z]{2,5})\b/g) ?? [])].filter(
    (n) => !COMMON_ACRONYMS.has(n) && !lowerSource.includes(n.toLowerCase()),
  );
  if (names.length) warnings.push(`Nomi di strumenti o sigle che non trovo nel CV: ${names.slice(0, 8).join(', ')}.`);
  const cvLanguages = new Set(findLanguages(cvText.toLowerCase()).map((l) => l.name));
  const newLanguages = findLanguages(text.toLowerCase())
    .map((l) => l.name)
    .filter((n) => !cvLanguages.has(n) && !findLanguages(offerText.toLowerCase()).some((l) => l.name === n));
  if (newLanguages.length) warnings.push(`Lingue che non sono nel tuo CV: ${newLanguages.join(', ')}.`);
  const emails = (text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []).filter((e) => !source.includes(e));
  if (emails.length) warnings.push(`Indirizzi email che non vengono dal CV: ${[...new Set(emails)].join(', ')}.`);
  return warnings;
}

/**
 * Importa la risposta di Claude e la controlla.
 * @returns {{ analysis, requirements, gaps, cv, changes, email, followUp, questions, warnings }}
 */
export function importKitAnswer(answer, { cvText = '', offerText = '' } = {}) {
  let data;
  try {
    data = extractJson(answer);
  } catch {
    throw new Error("Nella risposta non c'è il blocco ```json: copia tutta la risposta di Claude.");
  }
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const mail = (m) => ({ subject: str(m?.oggetto ?? m?.subject), body: str(m?.testo ?? m?.body) });
  const kit = {
    analysis: str(data.azienda),
    requirements: (Array.isArray(data.requisiti) ? data.requisiti : [])
      .map((r) => ({ requirement: str(r?.requisito), evidence: str(r?.nel_cv) || null }))
      .filter((r) => r.requirement),
    gaps: (Array.isArray(data.lacune) ? data.lacune : [])
      .map((g) => ({ requirement: str(g?.requisito), advice: str(g?.consiglio) }))
      .filter((g) => g.requirement),
    cv: str(data.cv),
    changes: (Array.isArray(data.modifiche) ? data.modifiche : []).map(str).filter(Boolean),
    email: mail(data.email),
    followUp: mail(data.sollecito),
    questions: (Array.isArray(data.domande) ? data.domande : []).map(str).filter(Boolean),
  };
  if (!kit.cv && !kit.email.body) throw new Error('La risposta non contiene né il CV né l’email.');
  const warnings = checkInvented([kit.cv, kit.email.body, kit.followUp.body].join('\n'), cvText, offerText);
  // Le frasi "nel CV" devono esserci davvero (almeno quasi tutte le parole).
  const cvStems = stems(cvText);
  for (const r of kit.requirements) {
    if (!r.evidence) continue;
    const s = [...stems(r.evidence)];
    if (s.length && s.filter((x) => cvStems.has(x)).length / s.length < 0.6) {
      warnings.push(
        `«${clip(r.evidence, 80)}» non sembra una frase del tuo CV (requisito: ${clip(r.requirement, 60)}).`,
      );
    }
  }
  return { ...kit, warnings };
}
