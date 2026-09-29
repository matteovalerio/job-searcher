/*
 * Competenze che si cercano negli annunci (e nel CV) per l'analisi del mercato.
 *
 *   detect    parole che indicano la competenza (con "*" = prefisso)
 *   category  strumento | competenza | formazione
 *   learn     come acquisirla o rafforzarla: risorse note (gratuite quando possibile) e tempo indicativo
 *   show      come farla vedere nel CV o in un portfolio, una volta acquisita
 *
 * Le risorse sono indicazioni generali, non pubblicità: prima di pagare un corso conviene confrontare le
 * alternative (anche i corsi gratuiti per chi cerca lavoro, tramite il Centro per l'impiego, per esempio con il
 * programma GOL). Per aggiungere una competenza basta aggiungere un oggetto qui sotto.
 */

// biome-ignore format: elenco lungo, più leggibile compatto
export const MARKET_SKILLS = [
  // Strumenti
  { id: 'indesign', label: 'Adobe InDesign', category: 'strumento', detect: ['indesign', 'adobe indesign'],
    learn: ['tutorial gratuiti di Adobe (helpx.adobe.com, sezione InDesign) e corsi su LinkedIn Learning o Udemy', 'esercizio: impaginare di nuovo un capitolo, un catalogo o una brochure', 'tempo indicativo: 20-30 ore'],
    show: 'aggiungilo nelle competenze con il livello e porta 2-3 impaginati in un portfolio PDF' },
  { id: 'photoshop', label: 'Adobe Photoshop', category: 'strumento', detect: ['photoshop'],
    learn: ['tutorial gratuiti di Adobe (helpx.adobe.com) sul ritocco e la preparazione delle immagini per la stampa', 'tempo indicativo: 10-15 ore per le basi utili in redazione'],
    show: 'indicalo tra gli strumenti, specificando l\'uso (preparazione delle immagini per la stampa)' },
  { id: 'illustrator', label: 'Adobe Illustrator', category: 'strumento', detect: ['illustrator'],
    learn: ['tutorial gratuiti di Adobe (helpx.adobe.com)', 'tempo indicativo: 15-20 ore per le basi'],
    show: 'indicalo tra gli strumenti con un esempio di lavoro' },
  { id: 'acrobat', label: 'Acrobat e controllo dei PDF di stampa', category: 'strumento', detect: ['acrobat', 'pdf di stampa', 'preflight', 'pdf/x'],
    learn: ['guide di Adobe su preflight e PDF/X', 'chiedere a una tipografia le specifiche dei file che accetta'],
    show: 'scrivi che sai preparare e controllare i PDF per la stampa' },
  { id: 'office', label: 'Word ed Excel avanzati', category: 'strumento', detect: ['excel', 'microsoft office', 'pacchetto office', 'office', 'word avanzato'],
    learn: ['Microsoft Learn (gratuito), in particolare stili e revisioni in Word e tabelle pivot in Excel', 'tempo indicativo: 10 ore'],
    show: 'indica le funzioni che usi davvero (stili, revisioni, stampa unione, tabelle pivot)' },
  { id: 'latex', label: 'LaTeX', category: 'strumento', detect: ['latex', 'overleaf'],
    learn: ['Overleaf Learn (gratuito, overleaf.com/learn)', 'esercizio: comporre un articolo con bibliografia in BibTeX', 'tempo indicativo: 15 ore'],
    show: 'indicalo tra gli strumenti con il tipo di testi composti' },
  { id: 'xml', label: 'XML, JATS e flussi editoriali digitali', category: 'strumento', detect: ['xml', 'jats', 'html', 'epub', 'ebook*', 'e-book*'],
    learn: ['documentazione gratuita di JATS (jats.nlm.nih.gov) ed EPUB (w3.org)', 'corsi introduttivi a HTML e XML su piattaforme gratuite', 'tempo indicativo: 20 ore'],
    show: 'racconta i progetti digitali seguiti (e-book, articoli in XML) e gli strumenti usati' },
  { id: 'cms', label: 'CMS e WordPress', category: 'strumento', detect: ['wordpress', 'cms', 'content management'],
    learn: ['Learn WordPress (gratuito, learn.wordpress.org)', 'esercizio: un piccolo sito o blog con i propri lavori', 'tempo indicativo: 10 ore'],
    show: 'indica il CMS e cosa ci facevi (pubblicazione, SEO di base, gestione delle immagini)' },
  { id: 'cat-tools', label: 'Strumenti di traduzione (Trados, memoQ)', category: 'strumento', detect: ['trados', 'memoq', 'matecat', 'cat tool*'],
    learn: ['formazione ufficiale RWS (Trados) o memoQ; Matecat è gratuito per fare pratica', 'tempo indicativo: 15 ore'],
    show: 'indica lo strumento e il tipo di revisione fatta' },
  { id: 'grafica-web', label: 'Canva e Figma', category: 'strumento', detect: ['canva', 'figma'],
    learn: ['Canva Design School e Figma Learn (gratuiti)', 'tempo indicativo: 5-10 ore'],
    show: 'indicalo tra gli strumenti con un esempio' },
  { id: 'journal-systems', label: 'Sistemi di gestione delle riviste (peer review)', category: 'strumento', detect: ['editorial manager', 'scholarone', 'ojs', 'open journal systems', 'manuscript tracking'],
    learn: ['guide e webinar gratuiti dei fornitori (Editorial Manager, ScholarOne) e documentazione di OJS', 'tempo indicativo: 5 ore'],
    show: 'se li hai usati, nominali: sono un requisito tipico delle riviste scientifiche' },
  { id: 'analytics', label: 'Google Analytics e dati del web', category: 'strumento', detect: ['google analytics', 'analytics', 'ga4'],
    learn: ['Google Skillshop (gratuito, con attestato)', 'tempo indicativo: 10 ore'],
    show: 'aggiungi l\'attestato Skillshop tra le certificazioni' },
  { id: 'pm-tools', label: 'Strumenti di gestione dei progetti', category: 'strumento', detect: ['asana', 'trello', 'jira', 'monday', 'ms project', 'microsoft project', 'notion'],
    learn: ['guide gratuite degli strumenti (Trello, Asana, Notion)', 'tempo indicativo: 3-5 ore'],
    show: 'indica lo strumento accanto ai progetti coordinati' },

  // Competenze
  { id: 'correzione-bozze', label: 'Correzione di bozze e revisione', category: 'competenza', detect: ['correzione di bozze', 'correzione bozze', 'correttore di bozze', 'correttrice di bozze', 'proofread*', 'revisione testi', 'revisione dei testi', 'copy editing', 'copyediting'],
    learn: ['corsi di redazione e correzione di bozze delle scuole di editoria', 'manuali di norme redazionali (per esempio le norme di una casa editrice)'],
    show: 'metti numeri concreti: quanti titoli o pagine, che tipo di testi' },
  { id: 'editing', label: 'Editing', category: 'competenza', detect: ['editing', 'editor', 'revisione editoriale'],
    learn: ['corsi di editing delle scuole di editoria', 'esercizio: un editing documentato di un testo, con le motivazioni delle scelte'],
    show: 'descrivi il tipo di editing (strutturale, di stile) e i generi' },
  { id: 'impaginazione', label: 'Impaginazione', category: 'competenza', detect: ['impaginazion*', 'impaginator*', 'impaginatric*', 'layout', 'desktop publishing', 'dtp'],
    learn: ['vedi Adobe InDesign', 'esercizio: impaginare un libretto o un catalogo per un\'associazione, come portfolio'],
    show: 'porta esempi impaginati in un portfolio PDF' },
  { id: 'copywriting', label: 'Copywriting e scrittura per il web', category: 'competenza', detect: ['copywriting', 'copywriter', 'scrittura per il web', 'web writing', 'content writ*', 'storytelling'],
    learn: ['corsi di scrittura per il web e copywriting (anche su Coursera o LinkedIn Learning)', 'esercizio: 3-4 testi di esempio (una scheda prodotto, una newsletter, un post)'],
    show: 'aggiungi un portfolio con testi di esempio' },
  { id: 'seo', label: 'SEO', category: 'competenza', detect: ['seo', 'search engine optimization', 'posizionamento sui motori'],
    learn: ['Google Search Central, guida introduttiva alla SEO (gratuita)', 'tempo indicativo: 10 ore'],
    show: 'indica le basi di SEO applicate ai testi' },
  { id: 'social', label: 'Social media e comunicazione digitale', category: 'competenza', detect: ['social media', 'social network', 'newsletter', 'comunicazione digitale', 'piano editoriale social'],
    learn: ['corsi gratuiti di Meta Blueprint e di Google (Skillshop)', 'esercizio: un piano editoriale di un mese per una casa editrice'],
    show: 'racconta risultati concreti (numeri, campagne) o un piano editoriale di esempio' },
  { id: 'project-management', label: 'Gestione dei progetti', category: 'competenza', detect: ['project manag*', 'gestione dei progetti', 'gestione progetti', 'coordinamento', 'coordinare', 'pianificazione'],
    learn: ['corsi introduttivi al project management (anche gratuiti su Coursera o Google)', 'certificazioni come CAPM o ISIPM-Base se servono per il ruolo'],
    show: 'per ogni progetto indica dimensione, tempi e persone coordinate' },
  { id: 'rapporti-autori', label: 'Rapporti con autori e collaboratori', category: 'competenza', detect: ['rapporti con gli autori', 'rapporti con autori', 'gestione degli autori', 'relazioni con gli autori', 'author relations', 'collaboratori esterni', 'freelance'],
    learn: ['si rafforza con l\'esperienza: racconta i casi concreti'],
    show: 'indica con quanti autori o collaboratori lavoravi e come gestivi tempi e revisioni' },
  { id: 'scientifico', label: 'Contenuti scientifici e medici', category: 'competenza', detect: ['scientific*', 'medical writ*', 'medico-scientific*', 'peer review', 'ecm', 'clinic*', 'farmac*'],
    learn: ['corsi di medical writing (per esempio quelli di EMWA)', 'conoscere le linee guida di scrittura scientifica (ICMJE)'],
    show: 'metti in evidenza le riviste, le aree e il tipo di contenuti seguiti' },
  { id: 'diritti', label: 'Diritti e aspetti legali dell\'editoria', category: 'competenza', detect: ['diritti d\'autore', 'diritto d\'autore', 'copyright', 'permessi', 'licenze', 'rights'],
    learn: ['corsi brevi sul diritto d\'autore in editoria (scuole di editoria, AIE)'],
    show: 'indica se hai gestito permessi per immagini o testi' },
  { id: 'marketing-editoriale', label: 'Marketing editoriale e ufficio stampa', category: 'competenza', detect: ['ufficio stampa', 'comunicati stampa', 'marketing editoriale', 'promozione', 'eventi', 'presentazioni'],
    learn: ['corsi di ufficio stampa e marketing editoriale', 'esercizio: un comunicato stampa per un libro reale'],
    show: 'porta un comunicato o un piano di promozione di esempio' },

  // Formazione e altro
  { id: 'laurea', label: 'Laurea', category: 'formazione', detect: ['laurea', 'laureato', 'laureata', 'degree', 'bachelor', 'master\'s'],
    learn: ['requisito di titolo: se manca, valutare corsi di perfezionamento o master brevi'],
    show: 'indica titolo, ateneo e voto se buono' },
  { id: 'master-editoria', label: 'Master o corsi di editoria', category: 'formazione', detect: ['master in editoria', 'corso di editoria', 'scuola di editoria', 'master editoria'],
    learn: ['master universitari e scuole di editoria (confronta costi, stage e sbocchi prima di iscriverti)'],
    show: 'indica corso, anno e progetto finale' },
  { id: 'patente', label: 'Patente e disponibilità a spostarsi', category: 'formazione', detect: ['patente', 'automunito', 'automunita', 'trasferte'],
    learn: ['requisito pratico: se c\'è, scrivilo'],
    show: 'aggiungi "patente B, automunita" tra i dati personali' },
];

/** Livelli di lingua, dal più basso al più alto. */
export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Come certificare o migliorare una lingua. */
// biome-ignore format: elenco compatto
export const LANGUAGE_LEARN = {
  inglese: 'certificazioni Cambridge (B2 First, C1 Advanced) o IELTS; per esercitarsi, leggere e revisionare testi editoriali in inglese',
  tedesco: 'certificazioni del Goethe-Institut (Goethe-Zertifikat)',
  francese: 'certificazioni DELF/DALF (Alliance Française, Institut français)',
  spagnolo: 'certificazioni DELE (Instituto Cervantes)',
};
