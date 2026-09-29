# CLAUDE.md

Guida per le sessioni di Claude che lavorano su questo repository. Il README è la documentazione per chi usa il
programma; qui ci sono le cose utili a chi lo modifica.

## Cos'è

`job-searcher` aiuta una persona a cercare lavoro, oggi soprattutto nel mondo editoriale (redazione, Padova/Vicenza
o full remote):
- cerca offerte su più portali e le filtra con un profilo;
- segue le candidature;
- trova case editrici e aziende affini a cui candidarsi spontaneamente;
- prepara testi da incollare su claude.ai: profilo, confronto tra CV e offerte, CV su misura, elenchi di aziende.

È fatto di due parti:
- **Riga di comando** in Node.js (`src/`, entrata `src/cli.js`). Contiene tutta la logica.
- **Interfaccia web** in Next.js (`web/`). Carica il codice di `src/` a runtime da `web/lib/core.js`, senza farlo
  impacchettare: le route in `web/app/api` chiamano le stesse funzioni della riga di comando.

## Comandi

```bash
npm test                  # test (node:test), senza rete: usano i file in test/fixtures
npm run lint              # Biome: formattazione e linter (lo stesso controllo della CI)
npm run format            # Biome: corregge formattazione e import
cd web && npx next build  # build dell'interfaccia (la CI la esegue)
node src/cli.js --help    # tutti i comandi
```

Prima di un commit: `npm run lint`, `npm test` e, se si tocca `web/` o qualcosa che usa (`src/` compreso), la build
di Next. La CI (`.github/workflows/test.yml`) esegue test su Node 20 e 22, lint e build web.

## Convenzioni

- **Lingua:** testi, messaggi, commenti e README in italiano semplice. L'utente scrive in italiano: rispondere in
  italiano.
- **Codice:** JavaScript ESM senza build e senza TypeScript; Node ≥ 20.12. Formattazione Biome (`biome.json`):
  righe da 120 caratteri, apici singoli. Le tabelle lunghe usano `// biome-ignore format: …`.
- **Dipendenze:** poche; prima di aggiungerne una, chiedersi se basta Node.
- **Test:** ogni funzione che interpreta dati esterni (portali, mappe, siti, risposte di Claude) ha un test con un
  file d'esempio in `test/fixtures/`. I test non usano la rete: le chiamate si iniettano (`http`, `fetchFn`, `web`…)
  o si simula `globalThis.fetch`.
- **Stato:** tutto quello che il programma salva sta in `.job-searcher/` (ignorato da git):
  - `tracking.json`: candidature alle offerte;
  - `publishers.json`: case editrici e aziende;
  - `cv.txt`: testo del CV;
  - `results-<profilo>.json`: ultimi risultati;
  - il profilo del browser.

  La cartella si può spostare con `JOB_SEARCHER_HOME`. I profili sono in `profiles/`.
- **Claude senza API:** le funzioni "con Claude" preparano un testo da incollare su claude.ai (l'utente usa
  l'abbonamento, non vuole spendere per l'API) e poi importano la risposta, di solito un blocco ```json.
  Ogni prompt vieta di inventare e il programma verifica ciò che importa: per esempio visita i siti delle aziende.

## Dove stanno le cose

- `src/sources/` contiene un modulo per portale (`index.js` li elenca). Le fonti generiche (RSS, HTML, pagine
  "lavora con noi", Workday/Greenhouse/Lever/SmartRecruiters) si configurano nel profilo con `customSources`.
- `src/search.js`, `filter.js`, `dedupe.js`, `extract.js` e `geo.js` fanno la ricerca: fonti, filtro per parole
  chiave e zona, doppioni, livello, contratto e stipendio.
- `src/profiles/` contiene i profili: archivio, analisi del CV, procedura guidata, prompt per Claude e le aree
  professionali (`roles.js`).
- `src/publishers/` contiene le case editrici e le aziende affini:
  - `sectors.js`: la tabella dei settori affini, con motivo, ruoli, come cercarli e focus per il CV;
  - `discover.js`: ricerca su OpenStreetMap (Overpass, una query per settore) e Wikidata;
  - `websearch.js`: ricerca web con Brave (facoltativa);
  - `import.js`: prompt e import degli elenchi;
  - `store.js`: archivio e stato delle candidature spontanee.
- `src/tailor.js` fa il CV su misura, con `src/publishers/specialties.js` per le specializzazioni editoriali.
- `src/market/` fa l'analisi del mercato: le offerte viste si accumulano per profilo; `catalog.js` elenca le
  competenze con le risorse per colmarle.
- `src/match.js` prepara il confronto tra CV e offerte; `src/tracking.js` segue le candidature.
- `src/commands/` contiene i comandi `publishers` e `cv`; gli altri sono in `src/cli.js`.
- `web/app/` contiene pagine, componenti e route `/api`; lo stile è tutto in `web/app/globals.css` (token di colore
  su `:root`, tema scuro).

## Da sapere

- **Rete:** nell'ambiente di sviluppo remoto molti siti (portali, Overpass, Wikidata) sono bloccati. Si prova con i
  file d'esempio, e il comportamento reale lo verifica l'utente, per esempio con `node src/cli.js doctor`.
- **Indeed** è stato tolto: la verifica anti-robot di Cloudflare andava in loop. InfoJobs usa un browser vero
  (Playwright), è facoltativo e i suoi termini d'uso non consentono la lettura automatica. Non aggiungere tecniche
  per aggirare le verifiche anti-robot.
- **L'utente usa WSL:** il browser parte con opzioni apposite (`src/browser.js`), e `node src/cli.js browser` apre
  la finestra per risolvere a mano le verifiche.
- **Ricerca automatica:** la ricerca quotidiana gira su GitHub Actions (`.github/workflows/ricerca-quotidiana.yml`),
  senza browser, e manda le novità su Telegram o per email.
- **Git:** i PR vengono uniti con rebase. Dopo un merge si riparte da `main` aggiornato.
