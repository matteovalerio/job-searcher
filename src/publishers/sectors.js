import { ROLE_FAMILIES } from '../profiles/roles.js';
import { compileKeywords, normalize } from '../text.js';

/*
 * Settori in cui cercare aziende: le case editrici e le realtà "affini", dove le stesse competenze servono
 * anche se il ruolo ha un altro nome (un'agenzia che impagina i libretti delle sagre cerca chi sa correggere
 * bozze e usare InDesign, anche se non lo chiama "redattore").
 *
 *   one       nome al singolare, per indicare il tipo di un'azienda
 *   why       perché è un settore affine: cosa si fa lì che il candidato sa già fare
 *   roles     ruoli da proporre in una candidatura spontanea
 *   focus     cosa valorizzare nel CV per questo settore (lo usa il "CV su misura")
 *   fit       quanto è vicino a ogni area professionale (vedi profiles/roles.js): serve a ordinarli
 *   osm       elementi di OpenStreetMap da cercare (selettori Overpass, senza la zona)
 *   matches   riconosce un elemento di OpenStreetMap di questo settore
 *   web       frasi per la ricerca web, {city} = città
 *   hint      parole che un risultato web deve contenere per essere tenuto
 *
 * Per aggiungere un settore basta aggiungere un oggetto qui sotto.
 */

const has = (re) => (t) => re.test(normalize(t.name));

// biome-ignore format: elenco lungo, più leggibile compatto
export const SECTORS = [
  {
    id: 'casa-editrice',
    label: 'Case editrici',
    one: 'casa editrice',
    why: 'il lavoro di redazione per cui il profilo è pensato',
    roles: ['redattore', 'editor', 'correttore di bozze', 'coordinatore editoriale'],
    focus: [],
    fit: { editoria: 5, scientifica: 4, traduzione: 2, giornalismo: 2, grafica: 1 },
    osm: [
      '["office"="publisher"]',
      '["office"]["name"~"edizion|editric|editor|editorial|publish|verlag",i]',
      '["shop"]["name"~"edizion|editric|editore",i]',
      '["craft"]["name"~"edizion|editric|editorial",i]',
    ],
    matches: (t) => t.office === 'publisher' || (Boolean(t.office || t.shop || t.craft) && has(/edizion|editric|editore|editorial|publish|verlag/)(t)),
    web: ['casa editrice {city}', 'edizioni {city} libri', 'editore indipendente {city}'],
    hint: /editor|edizion|editric|casa editrice|publish|collan/,
  },
  {
    id: 'studio-editoriale',
    label: 'Studi e servizi editoriali',
    one: 'studio editoriale',
    why: 'fanno redazione, editing e impaginazione per conto di più case editrici',
    roles: ['redattore', 'editor', 'correttore di bozze', 'impaginatore'],
    focus: [
      'versatilità: generi e tipi di libro diversi su cui si è lavorato',
      'rispetto delle scadenze e gestione di più progetti in parallelo',
      'competenze pratiche spendibili subito (correzione di bozze, editing, impaginazione in InDesign)',
    ],
    fit: { editoria: 5, scientifica: 3, traduzione: 3, grafica: 2 },
    osm: [],
    matches: () => false,
    web: ['studio editoriale {city}', 'servizi editoriali {city}'],
    hint: /studio editoriale|servizi editoriali|service editoriale|redazion|editing|impaginazion/,
  },
  {
    id: 'libreria',
    label: 'Librerie e librerie universitarie',
    one: 'libreria',
    why: 'catalogo, schede dei libri, eventi con gli autori; alcune (come Libreria Universitaria a Limena) hanno anche un marchio editoriale o un grande negozio online',
    roles: ['addetto al catalogo e alle schede libro', 'content editor per il negozio online', 'organizzazione di eventi e presentazioni'],
    focus: [
      'conoscenza del mondo del libro e dei cataloghi editoriali',
      'scrittura e revisione di testi brevi (schede, descrizioni, newsletter)',
      'rapporti con autori ed editori, organizzazione di presentazioni',
    ],
    fit: { editoria: 4, scientifica: 2, vendite: 3, clienti: 2, comunicazione: 2 },
    osm: ['["shop"="books"]'],
    matches: (t) => t.shop === 'books',
    web: ['libreria universitaria {city}', 'libreria indipendente {city}'],
    hint: /librer|bookshop|libri/,
  },
  {
    id: 'agenzia-comunicazione',
    label: 'Agenzie pubblicitarie e di comunicazione',
    one: 'agenzia di comunicazione',
    why: 'brochure, cataloghi, libretti per eventi e sagre, siti: servono testi corretti, impaginazione e coordinamento con i clienti',
    roles: ['copywriter', 'correttore di bozze', 'impaginatore', 'project manager'],
    focus: [
      'scrittura e revisione di testi brevi e chiari (copy, cataloghi, materiali per eventi)',
      'impaginazione con InDesign e rapporti con grafici e tipografie',
      'gestione di scadenze strette e di più clienti in parallelo',
    ],
    fit: { editoria: 4, comunicazione: 5, grafica: 4, giornalismo: 2, vendite: 1 },
    osm: ['["office"="advertising_agency"]', '["office"]["name"~"comunicazione|pubblicit|advertising|grafic",i]'],
    matches: (t) => t.office === 'advertising_agency' || (Boolean(t.office) && has(/comunicazione|pubblicit|advertising|grafic/)(t)),
    web: ['agenzia di comunicazione {city}', 'agenzia pubblicitaria {city}', 'studio grafico {city}'],
    hint: /comunicazion|pubblicit|advertising|grafic|marketing|brand/,
  },
  {
    id: 'tipografia',
    label: 'Tipografie e prestampa',
    one: 'tipografia',
    why: 'prestampa e controllo delle bozze, impaginazione, rapporti con editori e clienti',
    roles: ['addetto alla prestampa', 'correttore di bozze', 'grafico impaginatore'],
    focus: [
      'controllo di qualità delle bozze e delle prove di stampa',
      'impaginazione e preparazione dei file per la stampa',
      'rapporti con editori e clienti, rispetto dei tempi di produzione',
    ],
    fit: { editoria: 3, grafica: 5, progetti: 1 },
    osm: ['["craft"="printer"]', '["office"]["name"~"tipograf|arti grafiche|stamperia",i]', '["craft"]["name"~"tipograf|arti grafiche",i]'],
    matches: (t) => t.craft === 'printer' || has(/tipograf|arti grafiche|stamperia/)(t),
    web: ['tipografia {city}', 'stampa libri {city}'],
    hint: /tipograf|stampa|arti grafiche|prestampa/,
  },
  {
    id: 'traduzioni',
    label: 'Agenzie di traduzione',
    one: 'agenzia di traduzione',
    why: 'revisione e controllo di qualità dei testi tradotti, dove contano la formazione linguistica e la precisione',
    roles: ['revisore', 'project manager linguistico', 'post-editor'],
    focus: [
      'formazione linguistica e lingue conosciute (con i livelli)',
      'revisione e controllo di qualità dei testi',
      'coordinamento di collaboratori esterni e scadenze',
    ],
    fit: { traduzione: 5, editoria: 3, scientifica: 2 },
    osm: ['["office"]["name"~"traduzion|translation|interpret",i]'],
    matches: (t) => has(/traduzion|translation|interpret/)(t),
    web: ['agenzia di traduzioni {city}'],
    hint: /traduz|translat|interpret|localizz/,
  },
  {
    id: 'comunicazione-scientifica',
    label: 'Comunicazione medico-scientifica',
    one: 'agenzia di comunicazione scientifica',
    why: 'riviste, congressi, corsi ECM e materiali per aziende farmaceutiche: servono redattori abituati ai contenuti scientifici',
    roles: ['medical writer', 'redattore scientifico', 'project manager editoriale'],
    focus: [
      'esperienza con contenuti scientifici e rapporti con autori medici e ricercatori',
      'accuratezza, controllo delle fonti e delle bibliografie',
      'coordinamento di progetti editoriali con molti autori',
    ],
    fit: { scientifica: 5, editoria: 3, comunicazione: 2, ricerca: 2 },
    osm: [],
    matches: () => false,
    web: ['agenzia comunicazione medico scientifica {city}', 'provider ECM {city}', 'medical communication {city}'],
    hint: /medic|scientific|ecm|pharma|farmac|salute|congress/,
  },
  {
    id: 'universita',
    label: 'Università, enti di ricerca e fondazioni',
    one: 'università o ente di ricerca',
    why: 'uffici editoriali, riviste scientifiche e university press; spesso con concorsi o contratti a progetto',
    roles: ['redattore di riviste', 'editor per la university press', 'addetto alla comunicazione della ricerca'],
    focus: [
      'redazione di testi scientifici e rapporti con autori accademici',
      'norme redazionali, peer review e bibliografie',
      'formazione universitaria e voti',
    ],
    fit: { scientifica: 5, ricerca: 4, editoria: 3, formazione: 2 },
    osm: ['["amenity"="university"]["website"]', '["office"="research"]["website"]'],
    matches: (t) => t.amenity === 'university' || t.office === 'research',
    web: ['università {city} ufficio pubblicazioni', 'fondazione {city} pubblicazioni ricerca'],
    hint: /universit|ricerca|fondazion|istituto|research|press/,
  },
  {
    id: 'musei',
    label: 'Musei ed enti culturali',
    one: 'museo o ente culturale',
    why: 'cataloghi delle mostre, pannelli, testi divulgativi e ufficio stampa',
    roles: ['redattore di cataloghi', 'addetto alla comunicazione', 'ufficio stampa'],
    focus: [
      'cura di cataloghi e testi divulgativi, rapporti con curatori e grafici',
      'revisione accurata e scrittura per il pubblico',
    ],
    fit: { editoria: 3, comunicazione: 3, giornalismo: 2, formazione: 1 },
    osm: ['["tourism"="museum"]["website"]'],
    matches: (t) => t.tourism === 'museum',
    web: ['museo {city} ufficio stampa pubblicazioni', 'fondazione culturale {city}'],
    hint: /muse|fondazion|cultur|mostr|galleri/,
  },
  {
    id: 'formazione',
    label: 'E-learning e formazione',
    one: 'azienda di formazione',
    why: 'progettano e revisionano materiali didattici, corsi online e manuali',
    roles: ['content editor', 'instructional designer', 'revisore di materiali didattici'],
    focus: [
      'chiarezza e struttura dei testi, adattamento al pubblico',
      'revisione di contenuti tecnici o scientifici',
      'coordinamento con esperti e autori',
    ],
    fit: { formazione: 5, editoria: 3, scientifica: 2, comunicazione: 2 },
    osm: [],
    matches: () => false,
    web: ['e-learning {city}', 'formazione aziendale contenuti {city}'],
    hint: /learning|formazion|corsi|didattic|academy|training/,
  },
  {
    id: 'documentazione-tecnica',
    label: 'Documentazione tecnica',
    one: 'azienda di documentazione tecnica',
    why: 'manuali, istruzioni e cataloghi di prodotto: scrittura chiara, revisione e impaginazione',
    roles: ['technical writer', 'redattore tecnico', 'impaginatore di manuali'],
    focus: [
      'scrittura chiara e precisa, rispetto di norme e stili redazionali',
      'impaginazione di documenti lunghi (InDesign)',
      'rapporti con tecnici ed esperti per raccogliere le informazioni',
    ],
    fit: { editoria: 3, scientifica: 3, traduzione: 2, grafica: 2 },
    osm: [],
    matches: () => false,
    web: ['documentazione tecnica {city}', 'technical writing {city}'],
    hint: /documentazion|manual|technical|tecnic/,
  },
  {
    id: 'giornali',
    label: 'Testate e redazioni giornalistiche',
    one: 'testata giornalistica',
    why: 'redazioni di giornali e riviste locali: correzione, titolazione, impaginazione e scadenze quotidiane',
    roles: ['redattore', 'correttore', 'addetto al desk'],
    focus: [
      'lavoro con scadenze fisse e ritmi veloci',
      'revisione, titolazione e impaginazione',
    ],
    fit: { giornalismo: 5, editoria: 3, comunicazione: 2 },
    osm: ['["office"="newspaper"]'],
    matches: (t) => t.office === 'newspaper',
    web: ['giornale {city} redazione', 'rivista {city} redazione'],
    hint: /giornal|quotidian|rivist|magazine|notizie|testata|redazion/,
  },
];

/** Settori delle case editrici in senso stretto (la ricerca predefinita, come prima). */
export const PUBLISHING_SECTORS = ['casa-editrice', 'studio-editoriale', 'libreria'];

export const sectorById = (id) => SECTORS.find((s) => s.id === id) ?? null;

/** Nome al singolare del tipo di un'azienda (anche per i tipi scritti a mano o vecchi). */
export const kindLabel = (id) => sectorById(id)?.one ?? (id === 'altro' || !id ? 'altro' : id);

const familyMatchers = ROLE_FAMILIES.map((f) => ({ id: f.id, re: compileKeywords(f.detect ?? []) }));

/** Aree professionali riconosciute in un testo (profilo o CV), con quante parole le indicano. */
export function familiesFromText(text) {
  const norm = normalize(text);
  return Object.fromEntries(
    familyMatchers.map((f) => [f.id, f.re.filter(({ re }) => re.test(norm)).length]).filter(([, hits]) => hits > 0),
  );
}

/**
 * Settori ordinati per affinità con il candidato. Ogni area del profilo e del CV pesa in proporzione a quanto
 * è evidente rispetto alla principale (così un accenno alla linguistica non supera l'esperienza in redazione);
 * ogni settore pesa per quanto quell'area gli è vicina. Più è alto il punteggio, più il settore è vicino.
 * @returns {{ id, label, why, roles, score }[]}
 */
export function suggestSectors(text) {
  const families = familiesFromText(text);
  const strongest = Math.max(0, ...Object.values(families));
  if (!strongest) return [];
  const share = (family) => (families[family] ?? 0) / strongest;
  return SECTORS.map((s) => ({
    id: s.id,
    label: s.label,
    why: s.why,
    roles: s.roles,
    score: Math.round(Object.entries(s.fit).reduce((sum, [family, weight]) => sum + weight * share(family), 0) * 10),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Settori affini da proporre: i migliori per il candidato, escluse le case editrici in senso stretto. */
export function affineSectors(text, max = 6) {
  return suggestSectors(text)
    .filter((s) => !PUBLISHING_SECTORS.includes(s.id))
    .slice(0, max)
    .map((s) => s.id);
}

/** Interpreta l'elenco di settori chiesto: ids separati da virgola, "affini", "tutti" o niente (case editrici). */
export function resolveSectors(value, profileText = '') {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(',')).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return PUBLISHING_SECTORS;
  const out = new Set();
  for (const item of list) {
    if (item === 'tutti' || item === 'all') for (const s of SECTORS) out.add(s.id);
    else if (item === 'affini') for (const id of affineSectors(profileText)) out.add(id);
    else if (item === 'editoria') for (const id of PUBLISHING_SECTORS) out.add(id);
    else if (sectorById(item)) out.add(item);
    else
      throw new Error(`Settore sconosciuto "${item}". Settori: ${SECTORS.map((s) => s.id).join(', ')}, affini, tutti`);
  }
  return [...out];
}
