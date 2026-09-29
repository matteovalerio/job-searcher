/*
 * Aree professionali usate per costruire un profilo a partire da un CV o dalle risposte del candidato.
 *
 *   detect    parole che, trovate nel CV, indicano l'area (con "*" = prefisso)
 *   keywords  parole chiave dei titoli delle offerte (italiano e inglese)
 *   related   ruoli affini: tengono l'offerta ma con meno punti
 *   searchIt  ricerche da fare sui portali per le offerte in zona
 *   searchEn  ricerche in più per le offerte full remote internazionali
 *   boost     parole che alzano il punteggio se compaiono nell'annuncio
 *   exclude   parole che, nel titolo, indicano offerte da scartare anche se contengono una parola chiave
 *
 * Per aggiungere un'area basta aggiungere un oggetto qui sotto.
 */
// biome-ignore format: elenco lungo, più leggibile compatto
export const ROLE_FAMILIES = [
  {
    id: 'editoria',
    label: 'Editoria e redazione',
    detect: ['redattor*', 'redazion*', 'casa editrice', 'editoria', 'editoriale', 'bozze', 'editing', 'publishing', 'copy editing', 'proofread*', 'impaginazione'],
    keywords: ['redattore', 'redattrice', 'redazione', 'redazionale', 'editor', 'copyeditor', 'editorial*', 'correttore di bozze', 'correttrice di bozze', 'revisore testi', 'revisione testi', 'proofread*', 'publishing', 'publisher', 'journal', 'peer review', 'manuscript*'],
    related: ['impaginat*', 'indesign', 'desktop publishing'],
    searchIt: ['redattore', 'redattrice', 'editor', 'editoriale', 'correttore di bozze'],
    searchEn: ['editor', 'editorial', 'copy editor', 'proofreader', 'publishing'],
    boost: ['casa editrice', 'editoria', 'libri', 'saggistica', 'manoscritti', 'bozze', 'autori', 'authors', 'books', 'proofreading', 'copyediting', 'riviste', 'rivista'],
    exclude: ['video', 'montaggio', 'software', 'developer', 'engineer', 'promotore', 'promotrice', 'agente', 'commerciale', 'sales', 'seo', 'social media', 'tecnico', 'tecnica'],
  },
  {
    id: 'scientifica',
    label: 'Editoria scientifica e medical writing',
    detect: ['scientific*', 'riviste scientifiche', 'peer review', 'medical writ*', 'stm', 'accademic*', 'academic', 'pubblicazioni scientifiche'],
    keywords: ['journal', 'journals', 'peer review', 'manuscript*', 'medical writer', 'medical writing', 'scientific writer', 'scientific writing', 'scientific editor', 'medical editor'],
    related: ['medical communication*', 'comunicazione scientifica'],
    searchIt: ['medical writer'],
    searchEn: ['journal', 'peer review', 'medical writer'],
    boost: ['scientifica', 'scientifico', 'scientific', 'stm', 'medical', 'medicina', 'academic', 'accademico', 'universitaria', 'peer review', 'elsevier', 'springer', 'wiley', 'mdpi', 'frontiers', 'taylor & francis', 'sage publishing', 'de gruyter', 'karger', 'thieme', 'wolters kluwer', 'oxford university press', 'cambridge university press'],
    exclude: [],
  },
  {
    id: 'traduzione',
    label: 'Traduzione e localizzazione',
    detect: ['tradu*', 'translat*', 'localizzazion*', 'localization', 'interpret*', 'sottotitol*', 'terminolog*', 'linguistic*', 'linguist*'],
    keywords: ['traduttore', 'traduttrice', 'traduzioni', 'translator', 'translation', 'localizzazione', 'localization', 'interprete', 'interpreter', 'linguist*', 'language specialist'],
    related: ['sottotitol*', 'subtitl*', 'terminolog*', 'post-editor', 'post-editing'],
    searchIt: ['traduttore', 'localizzazione'],
    searchEn: ['translator', 'localization', 'linguist'],
    boost: ['trados', 'memoq', 'matecat', 'cat tool', 'localization'],
    exclude: [],
  },
  {
    id: 'giornalismo',
    label: 'Giornalismo',
    detect: ['giornalist*', 'journalis*', 'cronista', 'reporter', 'testata', 'ordine dei giornalisti', 'pubblicista'],
    keywords: ['giornalista', 'journalist', 'cronista', 'reporter', 'caporedattore', 'redattore', 'redattrice', 'news editor'],
    related: ['ufficio stampa', 'press office', 'content writer'],
    searchIt: ['giornalista', 'redattore'],
    searchEn: ['journalist', 'reporter', 'news editor'],
    boost: ['testata', 'quotidiano', 'agenzia di stampa', 'newsroom'],
    exclude: ['video', 'software', 'sales', 'commerciale'],
  },
  {
    id: 'comunicazione',
    label: 'Comunicazione, marketing e contenuti',
    detect: ['marketing', 'comunicazione', 'social media', 'content', 'copywrit*', 'ufficio stampa', 'brand', 'digital marketing', 'seo'],
    keywords: ['comunicazione', 'communication*', 'marketing', 'content', 'copywriter', 'social media', 'ufficio stampa', 'press office', 'pr specialist', 'brand'],
    related: ['event*', 'eventi', 'community manager'],
    searchIt: ['comunicazione', 'marketing', 'copywriter', 'content'],
    searchEn: ['content', 'copywriter', 'communications', 'marketing'],
    boost: ['content', 'storytelling', 'seo', 'google analytics', 'wordpress', 'canva'],
    exclude: ['sales', 'vendite', 'commerciale', 'agente', 'call center'],
  },
  {
    id: 'grafica',
    label: 'Grafica e design',
    detect: ['grafic*', 'graphic design*', 'illustrat*', 'ux', 'ui design*', 'figma', 'photoshop', 'art director'],
    keywords: ['grafico', 'grafica', 'graphic designer', 'designer', 'impaginat*', 'illustrator*', 'ux', 'ui', 'art director'],
    related: ['indesign', 'dtp', 'desktop publishing', 'visual'],
    searchIt: ['grafico', 'graphic designer', 'impaginatore'],
    searchEn: ['graphic designer', 'ux designer', 'visual designer'],
    boost: ['indesign', 'illustrator', 'photoshop', 'figma', 'adobe'],
    exclude: ['software engineer', 'developer', 'sales'],
  },
  {
    id: 'sviluppo',
    label: 'Sviluppo software',
    detect: ['sviluppator*', 'developer', 'programmat*', 'software engineer', 'frontend', 'front-end', 'backend', 'back-end', 'full stack', 'javascript', 'typescript', 'java', 'python', 'react', 'node.js'],
    keywords: ['developer', 'sviluppatore', 'sviluppatrice', 'programmatore', 'programmatrice', 'software engineer', 'engineer', 'frontend', 'front-end', 'backend', 'back-end', 'full stack', 'fullstack', 'devops'],
    related: ['tech lead', 'architect', 'qa'],
    searchIt: ['sviluppatore', 'developer', 'programmatore'],
    searchEn: ['software engineer', 'developer'],
    boost: ['javascript', 'typescript', 'java', 'python', 'react', 'node', 'sql', 'cloud', 'aws'],
    exclude: ['sales', 'commerciale', 'recruiter'],
  },
  {
    id: 'dati',
    label: 'Analisi dei dati',
    detect: ['data analyst', 'data scientist', 'analisi dati', 'business intelligence', 'power bi', 'tableau', 'statistic*', 'machine learning'],
    keywords: ['data analyst', 'data scientist', 'analista dati', 'business intelligence', 'bi analyst', 'data engineer', 'statistico', 'statistica'],
    related: ['analyst', 'analista', 'reporting'],
    searchIt: ['data analyst', 'analista dati'],
    searchEn: ['data analyst', 'data scientist'],
    boost: ['sql', 'python', 'power bi', 'tableau', 'excel'],
    exclude: ['sales', 'commerciale'],
  },
  {
    id: 'amministrazione',
    label: 'Amministrazione e contabilità',
    detect: ['contabil*', 'amministrativ*', 'accounting', 'bilancio', 'fatturazione', 'paghe', 'controllo di gestione', 'tesoreria'],
    keywords: ['contabile', 'amministrativo', 'amministrativa', 'impiegato amministrativo', 'impiegata amministrativa', 'accountant', 'accounting', 'controller', 'addetto contabilità', 'addetta contabilità'],
    related: ['back office', 'segreteria', 'segretaria', 'office manager'],
    searchIt: ['contabile', 'impiegato amministrativo', 'amministrazione'],
    searchEn: ['accountant', 'accounting'],
    boost: ['bilancio', 'fatturazione', 'sap', 'zucchetti', 'excel'],
    exclude: ['sales', 'commerciale', 'agente'],
  },
  {
    id: 'hr',
    label: 'Risorse umane',
    detect: ['risorse umane', 'human resources', 'recruit*', 'selezione del personale', 'talent acquisition', 'hr'],
    keywords: ['risorse umane', 'hr', 'human resources', 'recruiter', 'talent acquisition', 'selezione del personale', 'hr specialist', 'hr generalist'],
    related: ['formazione del personale', 'payroll', 'paghe'],
    searchIt: ['risorse umane', 'recruiter', 'hr'],
    searchEn: ['recruiter', 'hr specialist'],
    boost: ['selezione', 'onboarding', 'employer branding'],
    exclude: ['sales', 'commerciale'],
  },
  {
    id: 'vendite',
    label: 'Vendite e commerciale',
    detect: ['commerciale', 'sales', 'vendit*', 'account manager', 'business development', 'agente di commercio', 'key account'],
    keywords: ['commerciale', 'sales', 'venditore', 'venditrice', 'account manager', 'key account', 'business developer', 'business development', 'agente', 'area manager'],
    related: ['customer success', 'inside sales'],
    searchIt: ['commerciale', 'account manager', 'venditore'],
    searchEn: ['sales', 'account manager'],
    boost: ['b2b', 'crm', 'salesforce', 'portafoglio clienti'],
    exclude: [],
  },
  {
    id: 'clienti',
    label: 'Assistenza clienti e front office',
    detect: ['customer service', 'assistenza clienti', 'customer care', 'call center', 'front office', 'receptionist', 'help desk'],
    keywords: ['customer service', 'customer care', 'assistenza clienti', 'front office', 'receptionist', 'addetto accoglienza', 'addetta accoglienza', 'help desk', 'operatore call center', 'operatrice call center'],
    related: ['back office', 'segreteria'],
    searchIt: ['assistenza clienti', 'customer care', 'front office'],
    searchEn: ['customer service', 'customer support'],
    boost: ['lingue', 'crm', 'zendesk'],
    exclude: ['sales', 'vendita porta a porta'],
  },
  {
    id: 'formazione',
    label: 'Insegnamento e formazione',
    detect: ['insegnant*', 'docent*', 'teacher', 'tutor', 'formator*', 'educator*', 'insegnamento', 'didattic*'],
    keywords: ['insegnante', 'docente', 'teacher', 'tutor', 'formatore', 'formatrice', 'educatore', 'educatrice', 'instructional designer', 'e-learning'],
    related: ['didattic*', 'learning designer', 'content developer'],
    searchIt: ['insegnante', 'docente', 'formatore', 'tutor'],
    searchEn: ['teacher', 'tutor', 'instructional designer'],
    boost: ['scuola', 'didattica', 'e-learning', 'università'],
    exclude: ['sales', 'commerciale'],
  },
  {
    id: 'ricerca',
    label: 'Ricerca e università',
    detect: ['ricercator*', 'researcher', 'dottorato', 'phd', 'ph.d', 'assegno di ricerca', 'post-doc', 'postdoc', 'laboratorio'],
    keywords: ['ricercatore', 'ricercatrice', 'researcher', 'research assistant', 'research associate', 'assegnista', 'post-doc', 'postdoc', 'research fellow'],
    related: ['project officer', 'grant', 'research manager'],
    searchIt: ['ricercatore', 'assegno di ricerca'],
    searchEn: ['researcher', 'research assistant'],
    boost: ['università', 'university', 'phd', 'dottorato', 'pubblicazioni'],
    exclude: ['sales', 'commerciale'],
  },
  {
    id: 'progetti',
    label: 'Project management',
    detect: ['project manag*', 'gestione progetti', 'coordinamento progetti', 'coordinamento dei progetti', 'pmo', 'scrum', 'agile', 'prince2', 'pmp'],
    keywords: ['project manager', 'project coordinator', 'coordinatore progetti', 'coordinatrice progetti', 'pmo', 'program manager', 'project officer'],
    related: ['scrum master', 'product owner'],
    searchIt: ['project manager', 'coordinatore progetti'],
    searchEn: ['project manager', 'project coordinator'],
    boost: ['pmp', 'prince2', 'agile', 'scrum', 'coordinamento'],
    exclude: ['sales', 'commerciale'],
  },
  {
    id: 'legale',
    label: 'Area legale',
    detect: ['avvocat*', 'giurisprudenza', 'paralegal', 'giurist*', 'praticante avvocato', 'contrattualistica', 'legal counsel'],
    keywords: ['avvocato', 'avvocata', 'legale', 'legal counsel', 'paralegal', 'giurista', 'praticante avvocato', 'legal specialist', 'compliance'],
    related: ['contract manager', 'privacy', 'gdpr'],
    searchIt: ['avvocato', 'legale', 'giurista'],
    searchEn: ['legal counsel', 'paralegal'],
    boost: ['contrattualistica', 'diritto', 'gdpr'],
    exclude: ['sales', 'commerciale'],
  },
];

/** Parole da escludere quando il candidato ha già esperienza (anni). */
export const JUNIOR_EXCLUDES = [
  'stage',
  'tirocinio',
  'tirocinante',
  'internship',
  'intern',
  'apprendista',
  'apprendistato',
];

/** Software e competenze riconosciute nel CV (diventano parole "bonus"). */
// biome-ignore format: elenco lungo, più leggibile compatto
export const SKILLS = ['indesign', 'photoshop', 'illustrator', 'quarkxpress', 'acrobat', 'microsoft word', 'excel', 'powerpoint', 'latex', 'wordpress', 'trados', 'memoq', 'matecat', 'canva', 'figma', 'sql', 'python', 'javascript', 'typescript', 'java', 'react', 'sap', 'salesforce', 'google analytics', 'power bi', 'tableau', 'autocad', 'zucchetti', 'jira', 'notion'];

/** Lingue: nome italiano -> forme usate negli annunci e nei CV. */
// biome-ignore format: elenco lungo, più leggibile compatto
export const LANGUAGE_NAMES = {
  italiano: ['italiano', 'italiana', 'italian'],
  inglese: ['inglese', 'english'],
  francese: ['francese', 'french'],
  tedesco: ['tedesco', 'tedesca', 'german'],
  spagnolo: ['spagnolo', 'spagnola', 'spanish'],
  portoghese: ['portoghese', 'portuguese'],
  olandese: ['olandese', 'dutch'],
  russo: ['russo', 'russa', 'russian'],
  polacco: ['polacco', 'polish'],
  rumeno: ['rumeno', 'romeno', 'romanian'],
  arabo: ['arabo', 'arabic'],
  cinese: ['cinese', 'chinese', 'mandarin'],
  giapponese: ['giapponese', 'japanese'],
  greco: ['greco', 'greek'],
  turco: ['turco', 'turkish'],
  svedese: ['svedese', 'swedish'],
  ucraino: ['ucraino', 'ukrainian'],
  albanese: ['albanese', 'albanian'],
  croato: ['croato', 'croatian'],
  serbo: ['serbo', 'serbian'],
};

export const familyById = (id) => ROLE_FAMILIES.find((f) => f.id === id);
