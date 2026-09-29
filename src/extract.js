import { compileKeywords, findKeywords, normalize } from './text.js';

/*
 * Informazioni ricavate dal testo di un'offerta: livello, anni di esperienza richiesti, tipo di contratto,
 * orario e stipendio. Servono sia a mostrarle nei risultati sia ai filtri del profilo ("filters").
 * Sono ricavate con regole semplici: quando un'informazione non c'è (o non si capisce) resta vuota, e i filtri
 * non scartano mai un'offerta per un'informazione mancante.
 */

const SENIORITY = [
  ['stage', ['stage', 'stagista', 'tirocinio', 'tirocinante', 'internship', 'intern', 'trainee']],
  ['junior', ['junior', 'jr', 'entry level', 'entry-level', 'primo impiego', 'neolaureato', 'neolaureata', 'graduate']],
  [
    'senior',
    [
      'senior',
      'sr',
      'lead',
      'head of',
      'caporedattore',
      'caporedattrice',
      'direttore',
      'direttrice',
      'director',
      'principal',
      'chief',
      'responsabile',
    ],
  ],
  ['mid', ['mid', 'mid-level', 'middle', 'intermediate']],
].map(([level, words]) => [level, compileKeywords(words)]);

const CONTRACTS = [
  [
    'indeterminato',
    ['tempo indeterminato', 'contratto indeterminato', 'assunzione diretta', 'permanent', 'full-time permanent'],
  ],
  [
    'determinato',
    [
      'tempo determinato',
      'contratto a termine',
      'sostituzione maternita',
      'fixed-term',
      'fixed term',
      'temporary',
      'maternity cover',
      'maternity leave cover',
    ],
  ],
  [
    'autonomo',
    [
      'partita iva',
      'p. iva',
      'p.iva',
      'freelance',
      'libero professionista',
      'libera professionista',
      'collaborazione occasionale',
      'collaborazione',
      'contractor',
      'contract',
      '1099',
    ],
  ],
  ['somministrazione', ['somministrazione', 'agenzia per il lavoro', 'tramite agenzia']],
  ['apprendistato', ['apprendistato', 'apprendista']],
  ['stage', ['stage', 'tirocinio', 'internship']],
].map(([type, words]) => [type, compileKeywords(words)]);

const PART_TIME = compileKeywords(['part-time', 'part time', 'parttime', 'part_time', 'tempo parziale']);
const FULL_TIME = compileKeywords(['full-time', 'full time', 'fulltime', 'full_time', 'tempo pieno']);

/** Livello: prima dal titolo, poi (solo se chiaro) dalla descrizione. */
function seniority(title, body) {
  for (const text of [title, body]) {
    for (const [level, words] of SENIORITY) {
      // "responsabile" o "lead" nella descrizione sono troppo generici: per il testo lungo solo stage/junior/senior espliciti.
      if (text === body && !['stage', 'junior'].includes(level) && !/\bsenior\b/.test(text)) continue;
      if (findKeywords(text, words).length) return level;
    }
  }
  return null;
}

/** Anni di esperienza richiesti (il minimo indicato), solo se il numero è vicino a "esperienza"/"experience". */
export function yearsRequired(text) {
  const re =
    /(?:almeno|minimo|min\.?|at least|minimum|oltre)?\s*(\d{1,2})\s*(?:\+|\s*(?:-|–|a|to)\s*\d{1,2})?\s*(?:anni|anno|years?|yrs)\b/g;
  let best = null;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 45);
    if (!/esperienz|experience/.test(`${before} ${after}`)) continue;
    // "da 25 anni sul mercato", "esperienza ventennale dell'azienda": numeri troppo alti non sono requisiti.
    const n = Number(m[1]);
    if (n > 0 && n <= 20) best = best === null ? n : Math.min(best, n);
  }
  return best;
}

const CURRENCY = { '€': 'EUR', eur: 'EUR', euro: 'EUR', $: 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP' };

function amount(raw) {
  const s = raw.trim().toLowerCase();
  const k = s.endsWith('k');
  let digits = s.replace(/k$/, '').replace(/\s/g, '');
  // "24.000", "24,000", "1.600,50", "28,5k"
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(digits))
    digits = digits.replace(/[.,](\d{1,2})$/, '').replace(/[.,]/g, '');
  else digits = digits.replace(',', '.');
  const n = Number(digits);
  return Number.isFinite(n) ? { value: k ? n * 1000 : n, k } : null;
}

// Parole che dicono che l'importo è uno stipendio italiano anche senza "€" ("RAL 28.000 - 32.000").
const EUR_CONTEXT = /\b(ral|retribuzion|stipendi|lord|nett|mensil|annu|compenso)/;
// Importi che non sono stipendi: si scartano se una di queste parole sta subito prima.
const NOT_SALARY =
  /(capitale|fatturato|budget|finanziament|investiment|milion|miliard|bonus|buon[io] pasto|welfare|premio|rimborso|contribut|borsa di studio|fondat|founded|since|dal|nel|anno|year)[^\d]{0,30}$/;
// Stipendi annui lordi plausibili: fuori da questo intervallo è quasi sempre un altro numero.
const ANNUAL_RANGE = [6000, 250000];

/**
 * Stipendio da un campo dedicato o dal testo. Restituisce { min, max, currency, period, annualMin, annualMax }
 * oppure null. annualMin/annualMax sono una stima lorda annua (mensile x 12), assenti per le paghe orarie.
 * `currency` è null se l'annuncio non la dice e niente fa pensare all'euro (molti annunci remoti sono in dollari).
 */
export function parseSalary(fieldText, text) {
  const NUM = String.raw`\d[\d.,]*\s?k?`;
  const RANGE = String.raw`(${NUM})\s*(?:€|eur|euro|\$|usd|£)?(?:\s*(?:-|–|a|to|fino a)\s*(?:€|eur|euro|\$|usd|£)?\s*(${NUM}))?`;
  const candidates = [];
  if (fieldText) candidates.push({ c: normalize(fieldText), field: true });
  const t = normalize(text);
  const patterns = [
    String.raw`(?:ral|retribuzione|stipendio|compenso|salary|pay|compensation)[^\d€$£]{0,25}(€|eur|euro|\$|usd|£)?\s*${RANGE}`,
    String.raw`(€|eur|euro|\$|usd|£)\s*${RANGE}`,
    String.raw`()${RANGE}\s*(?:€|eur|euro|\$|usd|£)`,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(new RegExp(re, 'g'))) {
      // Il testo subito prima dice che è un altro importo (capitale sociale, bonus, "fondata nel 2015"…).
      const before = t.slice(Math.max(0, m.index - 40), m.index) + m[0].replace(/\d[\s\S]*$/, '');
      if (NOT_SALARY.test(before)) continue;
      candidates.push({ c: m[0], at: m.index });
    }
  }
  // Il campo dedicato prima; poi gli importi nell'ordine in cui compaiono nel testo (di solito la fascia viene
  // prima delle spiegazioni: "26.800 € - 28.800 € … un minimo di €26.800").
  candidates.sort((x, y) => (x.at ?? -1) - (y.at ?? -1));
  for (const { c, at } of candidates) {
    const m = c.match(new RegExp(RANGE));
    if (!m) continue;
    const a = amount(m[1]);
    const b = m[2] ? amount(m[2]) : null;
    if (!a) continue;
    // Un anno ("2015") senza valuta non è uno stipendio.
    const hasSymbol = Object.keys(CURRENCY).some((sym) => c.includes(sym));
    if (!hasSymbol && /^(19|20)\d\d$/.test(m[1].trim())) continue;
    // "28-32k": la "k" vale per entrambi i numeri.
    if (b?.k && !a.k && a.value < 1000) a.value *= 1000;
    const min = a.value;
    const max = b?.value ?? a.value;
    if (min < 5 || max < min) continue;
    const around = at == null ? c : t.slice(Math.max(0, at - 40), at + c.length + 30);
    const cur = hasSymbol
      ? Object.entries(CURRENCY).find(([sym]) => c.includes(sym))[1]
      : EUR_CONTEXT.test(around)
        ? 'EUR'
        : null;
    const after = at == null ? '' : t.slice(at + c.length, at + c.length + 20);
    let period = /mese|mensil|month|\/m\b|al mese/.test(c) || /mese|mensil|month/.test(after) ? 'mese' : null;
    if (/\bora\b|oraria|hour|\/h\b|per hour|all'ora/.test(c)) period = 'ora';
    if (!period) period = min >= 8000 ? 'anno' : min >= 400 ? 'mese' : 'ora';
    const factor = period === 'anno' ? 1 : period === 'mese' ? 12 : null;
    if (factor && (min * factor < ANNUAL_RANGE[0] || max * factor > ANNUAL_RANGE[1])) continue;
    return {
      min,
      max,
      currency: cur,
      period,
      ...(factor ? { annualMin: Math.round(min * factor), annualMax: Math.round(max * factor) } : {}),
    };
  }
  return null;
}

/** Tutte le informazioni ricavabili da un'offerta. */
export function extractInfo(job) {
  const title = normalize(job.title);
  const body = normalize(`${job.description} ${job.tags.join(' ')}`);
  const all = `${title} ${body}`;
  const contracts = CONTRACTS.filter(([, words]) => findKeywords(all, words).length).map(([type]) => type);
  return {
    seniority: seniority(title, body),
    yearsRequired: yearsRequired(body) ?? yearsRequired(title),
    contracts,
    workTime: findKeywords(all, PART_TIME).length
      ? 'part-time'
      : findKeywords(all, FULL_TIME).length
        ? 'full-time'
        : null,
    salary: parseSalary(job.salary, `${job.title} ${job.description}`),
  };
}

/** Breve descrizione leggibile: "senior · 3+ anni · indeterminato · 28-32k € anno". */
export function describeInfo(info) {
  if (!info) return '';
  const money = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  const s = info.salary;
  const symbol = { EUR: '€', USD: '$', GBP: '£' }[s?.currency] ?? '';
  return [
    info.seniority,
    info.yearsRequired ? `${info.yearsRequired}+ anni` : null,
    ...info.contracts.filter((c) => c !== info.seniority),
    info.workTime === 'part-time' ? 'part-time' : null,
    s ? `${money(s.min)}${s.max !== s.min ? `-${money(s.max)}` : ''} ${symbol}/${s.period}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
