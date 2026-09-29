import { companyName, salutation, signature } from './kit.js';
import { MARKET_SKILLS } from './market/catalog.js';
import { findSkills } from './market/index.js';

/*
 * Preparazione al colloquio, a partire dal kit di candidatura (analisi dell'annuncio, frasi del CV, lacune):
 *   - domande probabili, con le frasi del CV da usare per rispondere e un consiglio onesto per le lacune;
 *   - episodi del CV da preparare (situazione, cosa hai fatto, risultato: i dettagli li mette chi si candida);
 *   - cosa sapere dell'azienda e cosa cercare prima;
 *   - domande da fare;
 *   - promemoria nel calendario con data e ora, email di ringraziamento dopo il colloquio;
 *   - un testo per claude.ai per una simulazione del colloquio.
 * Come nel resto del programma non si scrive niente sul candidato che non sia nel CV.
 */

const label = (id) => MARKET_SKILLS.find((s) => s.id === id)?.label ?? id;
const learnFor = (text) =>
  findSkills(text)
    .map((id) => MARKET_SKILLS.find((s) => s.id === id))
    .find((s) => s?.learn?.length);

/**
 * Domande probabili: quelle di ogni colloquio, poi quelle che nascono dai requisiti e dalle lacune.
 * @returns {{ question, hint, evidence?: string[] }[]}
 */
export function likelyQuestions(kit, { salary = null } = {}) {
  const who = companyName(kit.company?.name ?? kit.job?.company) || 'l’azienda';
  const highlights = [...new Set((kit.covered ?? []).map((c) => c.highlight).filter(Boolean))].slice(0, 3);
  const out = [
    {
      question: 'Mi parli di lei.',
      hint: 'Due minuti: chi sei, cosa fai oggi, perché questo ruolo. Parti dalle esperienze più vicine all’annuncio.',
      evidence: highlights,
    },
    {
      question: `Perché proprio ${who}?`,
      hint: 'Cita qualcosa di preciso dell’azienda (catalogo, collane, progetti, clienti) che hai visto sul sito.',
    },
    {
      question: 'Perché cambia lavoro? / Cosa cerca in questo momento?',
      hint: 'Rispondi guardando avanti (cosa vuoi fare), senza parlare male di chi c’era prima.',
    },
  ];
  for (const c of (kit.covered ?? []).slice(0, 5)) {
    out.push({
      question: c.task
        ? `Come si organizzerebbe per «${c.requirement}»?`
        : `Mi racconta un’esperienza che mostri «${c.requirement}»?`,
      hint: c.note
        ? `${c.note} Racconta cosa hai fatto di concreto in quegli anni.`
        : 'Un episodio vero: la situazione, cosa hai fatto tu, com’è andata.',
      evidence: c.evidence,
    });
  }
  for (const gap of (kit.missing ?? []).slice(0, 4)) {
    const skill = learnFor(gap);
    out.push({
      question: `L’annuncio chiede «${gap}»: che esperienza ha?`,
      hint: `Sii onesta/o: di’ cosa hai fatto di più vicino e come intendi colmare la differenza${skill ? ` (per esempio: ${skill.learn[0]})` : ''}. Non dire di saperlo fare se non è vero.`,
    });
  }
  out.push({
    question: 'Quali sono le sue aspettative economiche?',
    hint: salary
      ? `Dagli annunci raccolti per il profilo la RAL indicata va da circa ${Math.round(salary.min / 1000)}k a ${Math.round(salary.max / 1000)}k (mediana ${Math.round(salary.median / 1000)}k, su ${salary.count} annunci). Indica una fascia, non una cifra sola.`
      : 'Informati prima sulla fascia del ruolo (la pagina Mercato la ricava dagli annunci) e indica una fascia, non una cifra sola.',
  });
  out.push({
    question: 'Ha domande per noi?',
    hint: 'Sempre sì: vedi le domande da fare qui sotto.',
  });
  return out;
}

/** Domande da fare all'azienda, adatte al tipo di ruolo. */
export function questionsToAsk(kit) {
  const out = [
    'Com’è organizzato il lavoro della redazione (o del team) e con chi lavorerei ogni giorno?',
    'Come si svolge una giornata tipo in questo ruolo?',
    'Quali sono le priorità dei primi mesi?',
    'Come valutate che il lavoro stia andando bene?',
    'Quali sono i prossimi passi della selezione e i tempi?',
  ];
  const tools = findSkills([kit.offerText, ...(kit.offer?.requirements ?? [])].join('\n'))
    .filter((id) => ['indesign', 'photoshop', 'acrobat', 'latex', 'cms', 'cat-tools'].includes(id))
    .map(label);
  if (tools.length)
    out.splice(
      2,
      0,
      `Quali strumenti usate (per esempio ${tools.join(', ')}) e come si inseriscono nel flusso di lavoro?`,
    );
  if (kit.company?.affine) out.splice(1, 0, `Chi si occupa oggi dei testi e come si coordina con il resto del team?`);
  return out;
}

/** Cosa sapere dell'azienda prima del colloquio: quello che si sa e cosa cercare. */
export function companyBrief(kit) {
  const c = kit.company ?? {};
  const known = [
    c.kindLabel && `Tipo: ${c.kindLabel}`,
    c.specialties?.length && `Specializzazioni (dal sito): ${c.specialties.join(', ')}`,
    c.description && `Come si descrive: ${c.description}`,
    ...(c.about ?? []).map((a) => `Dall’annuncio: ${a}`),
    c.contact && `Persona trovata sul sito: ${c.contact.name}, ${c.contact.role}`,
  ].filter(Boolean);
  const toCheck = [
    c.website ? `il sito (${c.website}): catalogo o servizi, ultime novità, chi ci lavora` : 'il sito dell’azienda',
    'le ultime uscite o i progetti recenti (da citare nella risposta «perché noi?»)',
    'chi ti farà il colloquio: ruolo e profilo pubblico',
    'come arrivare (o il collegamento, se è online) e quanto tempo serve',
  ];
  return { known, toCheck };
}

/** Episodi del CV da preparare: i punti più vicini all'annuncio, da raccontare con situazione, azione, risultato. */
export function stories(kit) {
  return [...new Set((kit.covered ?? []).map((c) => c.highlight).filter(Boolean))].slice(0, 4);
}

/** Email di ringraziamento da mandare entro un giorno dal colloquio. */
export function thankYouEmail(kit, { contacts = {}, interviewer = null } = {}) {
  const hello = salutation(
    { ...kit.company, contact: interviewer ? { name: interviewer } : kit.company?.contact },
    kit.job,
    'it',
  );
  return {
    subject: `Grazie per il colloquio – ${kit.job.title}`,
    body: [
      hello.dear,
      '',
      `${interviewer || kit.company?.contact ? 'la ringrazio' : 'vi ringrazio'} per il colloquio di oggi per la posizione di ${kit.job.title} e per il tempo che mi ${interviewer || kit.company?.contact ? 'ha' : 'avete'} dedicato.`,
      'Mi ha fatto piacere conoscere meglio il lavoro e il gruppo, e la posizione mi interessa ancora di più.',
      'Resto a disposizione per qualsiasi informazione o documento.',
      '',
      'Cordiali saluti,',
      signature(contacts),
    ]
      .join('\n')
      .trim(),
  };
}

const pad = (n) => String(n).padStart(2, '0');
const icsUtc = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const icsText = (s) =>
  String(s)
    .replace(/[;,]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n');

/** Il colloquio nel calendario (un'ora), con un avviso un'ora prima. */
export function interviewIcs(kit, interview, now = new Date()) {
  const start = new Date(interview.at);
  if (Number.isNaN(start.getTime())) throw new Error('Data del colloquio non valida');
  const end = new Date(start.getTime() + (interview.minutes ?? 60) * 60000);
  const who = companyName(kit.company?.name ?? kit.job?.company);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//job-searcher//colloqui//IT',
    'BEGIN:VEVENT',
    `UID:colloquio-${String(kit.job.id).replace(/[^\w-]/g, '')}-${start.getTime()}@job-searcher`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsText(`Colloquio: ${kit.job.title}${who ? ` – ${who}` : ''}`)}`,
    interview.where && `LOCATION:${icsText(interview.where)}`,
    `DESCRIPTION:${icsText([interview.with && `Con: ${interview.with}`, kit.job.url && `Annuncio: ${kit.job.url}`].filter(Boolean).join('\n'))}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Colloquio tra un’ora',
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .filter(Boolean)
    .join('\r\n');
}

/** Tutta la preparazione, dallo strumento interno. */
export function buildInterviewPrep(kit, { salary = null, contacts = {}, interview = null } = {}) {
  return {
    questions: likelyQuestions(kit, { salary }),
    stories: stories(kit),
    company: companyBrief(kit),
    ask: questionsToAsk(kit),
    thankYou: thankYouEmail(kit, { contacts, interviewer: interview?.with?.split(/,| e /)[0]?.trim() || null }),
    interview,
  };
}

/** Testo per claude.ai: simulazione del colloquio, con le regole contro le invenzioni. */
export function buildInterviewPrompt(kit, cvText = '', { interview = null } = {}) {
  const list = (items) => items.map((i) => `- ${i}`).join('\n');
  return `Preparami a un colloquio di lavoro. Voglio allenarmi con una simulazione.

<cv>
${cvText.trim() || '(il CV è allegato a questo messaggio)'}
</cv>

<annuncio>
Ruolo: ${kit.job.title}
${kit.job.company ? `Azienda: ${kit.job.company}\n` : ''}
${(kit.offerText ?? '').trim().slice(0, 5000) || '(testo non disponibile)'}
</annuncio>
${interview?.with ? `\nIl colloquio è con: ${interview.with}.` : ''}${interview?.mode ? `\nModalità: ${interview.mode}.` : ''}

Requisiti che il CV mostra:
${list((kit.covered ?? []).map((c) => `${c.requirement} (nel CV: «${c.evidence[0]}»)`)) || '- nessuno riconosciuto'}
Requisiti che il CV non mostra:
${list(kit.missing ?? []) || '- nessuno'}

REGOLE
1. Non inventare nulla su di me: esperienze, numeri, risultati e competenze vengono solo dal CV. Se per una buona risposta ti serve un dettaglio che non c'è, chiedimelo.
2. Per i requisiti che il CV non mostra, aiutami a rispondere con onestà (cosa ho fatto di vicino, come intendo colmare la differenza).
3. Non inventare informazioni sull'azienda: se non le sai, dimmi cosa cercare e dove.

COSA TI CHIEDO
1. Le 10 domande più probabili per questo annuncio, con una traccia di risposta basata solo sul CV.
2. Poi facciamo una simulazione: fammi una domanda alla volta, aspetta la mia risposta e dammi un commento breve e concreto (cosa va bene, cosa migliorare) prima della domanda successiva.
`;
}
