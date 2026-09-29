import { compileKeywords, normalize } from '../text.js';

/*
 * Specializzazioni editoriali: servono a descrivere una casa editrice (dal suo sito o dall'annuncio) e a decidere
 * che cosa valorizzare nel CV quando ci si candida.
 *
 *   detect    parole che indicano la specializzazione (con "*" = prefisso), in italiano e inglese
 *   focus     esperienze e competenze da mettere in primo piano nel CV
 *   downplay  cose da ridurre o spostare in fondo (restano, ma non devono dominare)
 *
 * Le voci sono generiche per chi lavora in redazione: il CV vero lo adatta poi Claude, seguendo queste indicazioni.
 */
// biome-ignore format: elenco lungo, più leggibile compatto
export const SPECIALTIES = [
  {
    id: 'bambini',
    label: 'Libri per bambini e ragazzi',
    detect: ['bambini', 'bambino', 'ragazzi', 'infanzia', 'prima infanzia', 'albi illustrati', 'albo illustrato', 'libri illustrati', 'young adult', 'children*', 'picture book*', 'kids'],
    focus: [
      'gestione del processo editoriale dal manoscritto alla stampa (tempi, fasi, controllo qualità)',
      'rapporti con autori, illustratori e grafici',
      'impaginazione con InDesign e lavoro con testo e immagini',
      'revisione e correzione di bozze, cura della lingua per un pubblico giovane',
      'coordinamento di progetti e di collaboratori esterni',
    ],
    downplay: ['contenuti scientifici specialistici e terminologia tecnica', 'peer review e processi delle riviste accademiche'],
  },
  {
    id: 'scientifica',
    label: 'Editoria scientifica e accademica',
    detect: ['scientific*', 'scientifica', 'scientifico', 'accademic*', 'academic', 'universitari*', 'university press', 'stm', 'peer review', 'journal*', 'riviste scientifiche', 'open access'],
    focus: [
      'redazione di testi scientifici e rapporti con autori accademici',
      'peer review, norme redazionali, bibliografie e citazioni',
      'rigore nella revisione di contenuti tecnici',
      'strumenti di produzione (LaTeX, XML, piattaforme editoriali) se presenti nel CV',
    ],
    downplay: ['attività promozionali o di comunicazione non legate alla produzione'],
  },
  {
    id: 'medicina',
    label: 'Medicina e salute',
    detect: ['medicina', 'medico', 'medica', 'medical', 'sanita*', 'salute', 'health*', 'farmac*', 'pharma*', 'clinic*', 'infermieristic*'],
    focus: [
      'esperienza con contenuti medico-scientifici e terminologia',
      'accuratezza nella revisione e controllo delle fonti',
      'rapporti con autori medici e specialisti',
    ],
    downplay: ['esperienze editoriali lontane dall\'ambito sanitario (tenerle brevi)'],
  },
  {
    id: 'scolastica',
    label: 'Scolastica e didattica',
    detect: ['scolastic*', 'scuola', 'scuole', 'didattic*', 'educational', 'education', 'testi scolastici', 'libri di testo', 'textbook*', 'insegnanti', 'studenti'],
    focus: [
      'redazione e revisione di testi didattici, chiarezza ed esercizi',
      'rapporti con autori-insegnanti e coordinamento di opere in più volumi',
      'competenze linguistiche e cura dell\'adattamento al livello degli studenti',
      'impaginazione e gestione dell\'apparato iconografico',
    ],
    downplay: ['specializzazione in un singolo ambito disciplinare, se lontano dalle materie scolastiche'],
  },
  {
    id: 'narrativa',
    label: 'Narrativa e letteratura',
    detect: ['narrativa', 'romanz*', 'letteratura', 'letterari*', 'poesia', 'fiction', 'novel*', 'literary', 'racconti', 'giallo', 'gialli'],
    focus: [
      'editing e revisione di testi, sensibilità per stile e lingua',
      'formazione linguistica e letteraria',
      'rapporti con autori, agenti e traduttori',
      'correzione di bozze e cura dell\'edizione',
    ],
    downplay: ['aspetti tecnico-scientifici dei contenuti curati'],
  },
  {
    id: 'saggistica',
    label: 'Saggistica e divulgazione',
    detect: ['saggistica', 'saggi', 'divulgazione', 'divulgativ*', 'non fiction', 'nonfiction', 'popular science', 'attualita', 'storia', 'filosofia'],
    focus: [
      'capacità di rendere chiari contenuti complessi (il background scientifico è un punto di forza)',
      'editing strutturale e revisione dei testi',
      'rapporti con autori esperti e coordinamento dei progetti',
    ],
    downplay: ['procedure tipiche delle riviste accademiche (peer review, submission)'],
  },
  {
    id: 'arte',
    label: 'Arte, fotografia e libri illustrati',
    detect: ['arte', 'artistic*', 'fotografi*', 'photography', 'illustrat*', 'cataloghi', 'catalogo', 'architettura', 'architecture', 'libri d\'arte'],
    focus: [
      'impaginazione e gestione delle immagini (InDesign, Photoshop)',
      'rapporti con tipografie, grafici e fornitori, controllo delle prove di stampa',
      'coordinamento di progetti con molti collaboratori',
    ],
    downplay: ['lavoro sul contenuto scientifico dei testi'],
  },
  {
    id: 'riviste',
    label: 'Riviste e periodici',
    detect: ['rivista', 'riviste', 'periodic*', 'magazine*', 'testata', 'testate', 'mensile', 'settimanale'],
    focus: [
      'lavoro con scadenze fisse e uscite periodiche',
      'coordinamento di collaboratori e rapporti con gli autori',
      'titolazione, revisione e impaginazione',
    ],
    downplay: ['progetti librari molto lunghi (tenerli sintetici)'],
  },
  {
    id: 'lingue',
    label: 'Lingue, traduzioni e dizionari',
    detect: ['dizionari*', 'dictionar*', 'lingue', 'linguistic*', 'traduzion*', 'translation*', 'grammatic*', 'lessicograf*', 'lexicograph*'],
    focus: [
      'laurea in linguistica e competenze linguistiche (con i livelli)',
      'revisione di traduzioni e rapporti con i traduttori',
      'precisione terminologica',
    ],
    downplay: ['competenze di impaginazione, se non richieste'],
  },
  {
    id: 'digitale',
    label: 'Editoria digitale ed e-book',
    detect: ['ebook*', 'e-book*', 'epub', 'editoria digitale', 'digital publishing', 'audiolibr*', 'audiobook*'],
    focus: [
      'strumenti e formati digitali (ePub, XML, CMS) se presenti nel CV',
      'flussi di produzione e controllo qualità dei file',
    ],
    downplay: ['attività esclusivamente legate alla stampa'],
  },
];

/** Tipi di realtà editoriali da seguire. */
export const PUBLISHER_KINDS = {
  'casa-editrice': 'casa editrice',
  'studio-editoriale': 'studio editoriale',
  altro: 'altro',
};

// Indizi che un'azienda è uno studio o un servizio editoriale (lavora per altri editori).
const STUDIO_HINTS = compileKeywords([
  'studio editoriale',
  'servizi editoriali',
  'service editoriale',
  'agenzia editoriale',
  'editorial services',
  'packag*',
]);

const compiled = SPECIALTIES.map((s) => ({ ...s, re: compileKeywords(s.detect) }));

/**
 * Specializzazioni riconosciute in un testo (sito, descrizione, annuncio), dalla più evidente.
 * Una specializzazione conta se compare almeno `min` volte tra parole diverse.
 */
export function detectSpecialties(text, { min = 1, max = 3 } = {}) {
  const norm = normalize(text);
  return compiled
    .map((s) => ({ id: s.id, hits: s.re.filter(({ re }) => re.test(norm)).length }))
    .filter((s) => s.hits >= min)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
    .map((s) => s.id);
}

export function guessKind(text) {
  return STUDIO_HINTS.some(({ re }) => re.test(normalize(text))) ? 'studio-editoriale' : 'casa-editrice';
}

export const specialtyLabel = (id) => SPECIALTIES.find((s) => s.id === id)?.label ?? id;
