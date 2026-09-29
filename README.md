# job-searcher

Cerca offerte di lavoro su più portali in una volta sola, filtrandole per **parole chiave** e **area geografica** (oppure **full remote**). Mostra i risultati nel terminale, crea un report HTML e ricorda le offerte già viste, così a ogni esecuzione trovi le nuove evidenziate.

È una CLI in Node.js (JavaScript, senza build). Ogni portale è un piccolo modulo, quindi aggiungerne altri è semplice.

## Installazione

Serve Node.js 20.12 o successivo.

```bash
npm install
cp .env.example .env   # opzionale: chiavi API gratuite per Adzuna e Jooble
```

## Uso rapido

### 1. Crea un profilo di ricerca

Il profilo dice cosa cercare (ruoli, parole da escludere, lingue) e dove (città con raggio e/o full remote). Il modo più semplice per crearlo è partire dal CV:

```bash
node src/cli.js profile new --cv ~/Documenti/cv.pdf
```

Il programma legge il CV e ne ricava:
- aree professionali;
- anni di esperienza (stage e tirocini esclusi);
- titoli di studio;
- lingue e livello;
- competenze (InDesign, Excel, …);
- città.

Poi propone le parole chiave e fa qualche domanda per confermarle o correggerle.

- **Senza CV** basta `node src/cli.js profile new`: le domande sono le stesse, senza proposte ricavate dal CV.
- **Per modificare una lista proposta:** invio conferma, `+parola` aggiunge, `-parola` toglie, oppure scrivi una lista nuova separata da virgole.
- **Per accettare tutto senza domande:** `--yes` (solo con `--cv`).

I profili sono salvati in `profiles/<nome>.json`, che puoi anche modificare a mano (vedi [Il profilo di ricerca](#il-profilo-di-ricerca)).

```bash
node src/cli.js profiles                         # elenca i profili salvati
node src/cli.js profile show redattore-padova    # mostra un profilo
```

L'analisi del CV funziona a regole, senza inviare il CV a servizi esterni. Riconosce le aree elencate in `src/profiles/roles.js`, a cui se ne possono aggiungere altre. Non legge i CV scansionati come immagine: in quel caso usa la modalità senza CV.

#### In alternativa: farsi aiutare da Claude (con l'abbonamento, senza API)

L'analisi a regole conosce solo le aree professionali del dizionario. Per profili più ricchi o per professioni non previste, puoi far scrivere il profilo a Claude su claude.ai. Usi il tuo abbonamento (Pro o gratuito): niente chiavi API e nessun costo in più.

```bash
node src/cli.js profile prompt --cv ~/Documenti/cv.pdf -o prompt.txt
```

1. Il comando prepara un testo con le istruzioni, il formato del profilo, un esempio e il testo del CV. Senza `--cv` il testo ti chiede di allegare il PDF nella chat.
2. Incolla il testo in una nuova chat su claude.ai. Claude riassume il CV e ti fa qualche domanda: che lavoro cerchi, dove, se vuoi anche il remoto, cosa evitare.
3. Dopo le tue risposte, Claude scrive il profilo in un blocco JSON.
4. Copia la risposta in un file ed esegui `node src/cli.js profile import risposta.txt`. In alternativa esegui `node src/cli.js profile import` e incolla la risposta direttamente nel terminale.

Il programma estrae il JSON dalla risposta, lo controlla con le stesse verifiche della ricerca (per esempio che le città siano comuni italiani esistenti) e lo salva in `profiles/`. Se qualcosa non va, l'errore è scritto in modo da poterlo rigirare a Claude per farlo correggere. Il nome del profilo è quello scelto da Claude, a meno di indicarne un altro con `--name`.

Tieni presente che in questo modo il CV, con i dati personali che contiene, viene inviato a claude.ai.

### 2. Cerca

```bash
node src/cli.js search -p redattore-padova
```

Con `-p` indichi il nome del profilo (oppure il percorso di un file JSON). `npm run search` lancia il profilo incluso `redattore-padova`; per un altro profilo: `npm run search -- -p <nome>`. Il comando:

1. interroga i portali per le zone del profilo e per le offerte full remote;
2. tiene solo le offerte pertinenti e dà loro un punteggio (e per ogni fonte ti dice quante ne ha scartate e perché);
3. unisce i duplicati trovati su portali diversi;
4. stampa i risultati e salva un report HTML in `reports/`, con un filtro testuale e l'opzione "solo nuove".

Altri esempi:

```bash
# ricerca veloce senza profilo
node src/cli.js search -k "redattore,editor,correttore di bozze" -l "Padova,Vicenza" -r 40 --remote

# mostra anche le offerte scartate e il motivo (utile per regolare il profilo)
node src/cli.js search -p redattore-padova --explain

# solo le offerte mai viste prima, salvate anche in CSV (apribile con Excel)
node src/cli.js search -p redattore-padova --only-new -o offerte.csv

# solo alcune fonti
node src/cli.js search -p redattore-padova -s linkedin,remotive

# elenco delle fonti e del loro stato (es. chiave API mancante)
node src/cli.js sources

node src/cli.js --help
```

Per installare il comando `job-searcher` globalmente, esegui `npm link`. La cartella dei profili si può cambiare con `JOB_SEARCHER_PROFILES`.

## Interfaccia web

Oltre alla riga di comando c'è un'interfaccia web, in Next.js, che gira sul tuo computer e usa gli stessi file (profili, candidature, risultati, `.env`):

```bash
npm install            # nella cartella principale, se non l'hai già fatto
cd web
npm install
npm run dev            # poi apri http://localhost:3000
```

Per un uso quotidiano è più veloce la versione compilata: `npm run build` una volta, poi `npm start`.

- **Barra laterale:** le sezioni e il *profilo attivo*, che resta scelto anche chiudendo il browser.
- **Offerte:** premi «Avvia ricerca». L'avanzamento di ogni fonte compare mentre arriva. I risultati sono divisi per zona e si filtrano per testo o «solo nuove». Accanto a ogni offerta puoi scegliere uno stato e scrivere una nota; le offerte segnate «non mi interessa» o «non selezionata» spariscono.
- **Candidature:** una bacheca a colonne (da candidarsi, candidato, colloquio, chiuse). Sposti le offerte trascinandole o scegliendo lo stato, scrivi note o smetti di seguirle.
- **Offerte → «Prompt per Claude»:** prepara il testo per confrontare il CV con le offerte migliori dell'ultima ricerca (vedi [Quali offerte scegliere](#quali-offerte-scegliere-con-laiuto-di-claude)). Lo copi, lo incolli su claude.ai e alleghi il CV.
- **Case editrici e affini:** le candidature spontanee a case editrici e aziende di settori affini, con la ricerca di nuove aziende e il «CV su misura» (vedi [Case editrici, aziende affini e candidature spontanee](#case-editrici-aziende-affini-e-candidature-spontanee)).
- **Profili:** l'elenco dei profili e la modifica del JSON, con gli stessi controlli della ricerca prima di salvare (per esempio i comuni).
- **Profili → «Nuovo profilo»:** crea un profilo in due modi, come dalla riga di comando.
  - *Procedura guidata:* carichi il CV in PDF (facoltativo); le aree, gli anni di esperienza, le parole chiave, le lingue e i filtri vengono proposti dal CV. Controlli, correggi e salvi.
  - *Con l'aiuto di Claude:* il programma prepara il testo (con il CV, se l'hai caricato), tu lo incolli su claude.ai e poi incolli qui la risposta con il blocco JSON. Il profilo viene controllato prima di salvarlo.

Si può fare una ricerca alla volta. InfoJobs apre il browser come dalla riga di comando; se non ti serve, spunta «Salta InfoJobs». Il codice dell'interfaccia è in `web/app` (pagine e route `/api`). Il collegamento con il programma è in `web/lib/core.js`.

## Seguire le candidature

Ogni offerta nei risultati ha un codice tra parentesi quadre, per esempio `[3359919]`. Lo stesso codice compare anche nel report HTML. Con il codice puoi segnare a che punto sei:

```bash
node src/cli.js track 3359919 interessante
node src/cli.js track 3359919 candidatura --note "CV inviato il 29/9"
node src/cli.js track 3359919 colloquio
node src/cli.js track                  # elenco per stato
node src/cli.js track colloquio        # solo un certo stato
node src/cli.js track 3359919 rimuovi  # smetti di seguirla
```

Gli stati sono:
- `interessante`
- `candidatura` (candidatura inviata)
- `colloquio`
- `offerta` (offerta ricevuta)
- `rifiutata` (non selezionata)
- `scartata` (non mi interessa)

**Nelle ricerche successive:** le offerte seguite mostrano il loro stato accanto al titolo. Quelle segnate `scartata` o `rifiutata` non compaiono più, né nei risultati né nelle notifiche.

**Dove sono i dati:** in `.job-searcher/tracking.json`, insieme alla cronologia degli stati e a una copia dei dati dell'offerta, che resta consultabile anche quando l'annuncio sparisce dal portale.

Per ritrovare un'offerta dal codice si usano gli ultimi risultati di ogni profilo, salvati in `.job-searcher/results-<profilo>.json`. Quindi il codice funziona per le offerte dell'ultima ricerca.

## Ricerca automatica ogni giorno (GitHub Actions)

Il repository contiene un workflow (`.github/workflows/ricerca-quotidiana.yml`) che ogni mattina esegue la ricerca sui server di GitHub, gratis, e manda **solo le offerte nuove** su Telegram, per email o su entrambi. Non serve tenere acceso il computer.

- **Fonti:** InfoJobs è escluso, perché richiede un browser e la verifica anti-robot. Tutte le altre fonti funzionano.
- **Prima esecuzione:** arriva un riepilogo con le 10 offerte migliori per zona. Dalla seconda in poi arrivano solo quelle mai viste.
- **Memoria:** l'elenco delle offerte già viste è conservato nella cache di GitHub Actions.
- **Se l'invio fallisce:** l'elenco non viene aggiornato, così le offerte arrivano con l'esecuzione successiva.
- **Report completo:** il report HTML di ogni esecuzione si scarica dalla pagina dell'esecuzione su GitHub (sezione *Artifacts*), a cui porta il link "Report completo" del messaggio.
- **Case editrici e aziende affini:** dopo le offerte, il workflow esegue `publishers auto`. Una volta a settimana cerca nuove aziende nella zona del profilo, sia editoria sia settori affini. Ogni giorno sorveglia tutte quelle in elenco e manda un messaggio con le novità: annunci nuovi nelle pagine «lavora con noi», avvisi come «cerchiamo…», aziende nuove da valutare. Vedi [Sorvegliare le aziende](#sorvegliare-le-aziende). Con il segreto facoltativo `BRAVE_SEARCH_API_KEY` la ricerca settimanale usa anche il web. L'elenco usato da GitHub è separato da quello sul tuo computer: vive nella cache del workflow.

### Configurazione

Tutto si fa da GitHub, nel repository: **Settings → Secrets and variables → Actions**.

**1. Scegli il canale e aggiungi i segreti** (scheda *Secrets*):

- **Telegram** (consigliato: gratuito e immediato)
  1. In Telegram scrivi a [@BotFather](https://t.me/BotFather), manda `/newbot` e segui le istruzioni: alla fine ricevi il *token* del bot.
  2. Scrivi un messaggio qualsiasi al tuo nuovo bot, poi apri nel browser `https://api.telegram.org/bot<TOKEN>/getUpdates` e cerca `"chat":{"id":…}`: quel numero è il *chat id*.
  3. Aggiungi i segreti `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`.
- **Email**
  - Servono `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (la password del server di posta) ed `EMAIL_TO` (l'indirizzo a cui mandare le offerte).
  - Facoltativo: `EMAIL_FROM`, se deve essere diverso da `SMTP_USER`.
  - Con Gmail: `SMTP_HOST` = `smtp.gmail.com`, `SMTP_PORT` = `465`, `SMTP_USER` = il tuo indirizzo Gmail. Come `SMTP_PASS` crea una [password per le app](https://myaccount.google.com/apppasswords); serve la verifica in due passaggi attiva.

Per le fonti con chiave API aggiungi anche `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` e `JOOBLE_API_KEY`; per la ricerca web delle aziende, `BRAVE_SEARCH_API_KEY`.

**2. Facoltativo: variabili** (scheda *Variables*):
- `JOB_SEARCHER_PROFILE`: il profilo da usare (default `redattore-padova`). Il profilo deve essere nel repository, cioè in `profiles/` con commit e push.
- `JOOBLE_HOST`: per esempio `it.jooble.org`, se serve.

**3. Prova subito:** scheda **Actions** → *Ricerca quotidiana* → **Run workflow**. Qui puoi anche scegliere un profilo diverso per quella esecuzione.

**Orario:** l'ora si cambia nel file del workflow (`cron: '23 5 * * *'` = 5:23 UTC, cioè le 7:23 d'estate e le 6:23 d'inverno in Italia).

**Da sapere:**
- Se il repository è **pubblico**, i profili e i log delle esecuzioni sono visibili a tutti. I segreti restano nascosti; i profili contengono solo parole chiave e città, ma il blocco `candidate` creato da `profile new` riporta anche studi e anni di esperienza. Se preferisci, rendi il repository privato: per un uso come questo i minuti gratuiti di GitHub Actions bastano ampiamente.
- GitHub sospende i workflow pianificati dei repository pubblici senza attività da 60 giorni e manda un'email; basta riattivarlo dalla scheda *Actions*.
- Lo stesso comando funziona anche sul tuo computer, per esempio con cron: `node src/cli.js search -p <nome> --notify`. Le variabili vanno nel file `.env`; lì InfoJobs resta disponibile, a meno di usare `--no-browser`.

## Fonti incluse

| Fonte | Zona geografica | Full remote | Note |
|---|---|---|---|
| LinkedIn | ✓ | ✓ | pagina pubblica delle offerte, senza login. Spesso ignora la località (i risultati vengono filtrati per distanza) e, se si fanno troppe richieste, risponde con errore 429 |
| InfoJobs | ✓ | | **da attivare** (`"enableSources": ["infojobs"]`). Usa un vero browser: vedi sotto |
| Adzuna | ✓ | ✓ | aggregatore con API gratuita, copre l'Italia (per il remoto cerca offerte italiane che citano il lavoro da remoto). Richiede `ADZUNA_APP_ID` e `ADZUNA_APP_KEY` |
| Jooble | ✓ | | aggrega molti portali italiani (InfoJobs, Indeed, siti aziendali…). Richiede `JOOBLE_API_KEY`; se dà sempre 0 risultati prova `JOOBLE_HOST=it.jooble.org` |
| Remotive | | ✓ | API pubblica |
| Remote OK | | ✓ | API pubblica |
| Jobicy | | ✓ | API pubblica |
| Himalayas | | ✓ | API pubblica |
| We Work Remotely | | ✓ | feed RSS |
| inPA | ✓ | | concorsi e avvisi di tutta la pubblica amministrazione (comuni, università, biblioteche, musei…), dal portale inpa.gov.it |

Le fonti che richiedono una chiave vengono **saltate** se la chiave manca: la ricerca funziona lo stesso. Consiglio comunque di registrarti gratis su Adzuna e Jooble, perché sono il modo più affidabile per coprire i portali italiani. Subito blocca le letture automatiche delle sue pagine.

### InfoJobs (con il browser)

InfoJobs non ha un'API pubblica e blocca gli script, quindi questa fonte apre **Chrome** (tramite Playwright, installato da `npm install`) e legge le pagine dei risultati come farebbe una persona.

**Indeed non c'è più.** Anche con il browser vero, la verifica anti-robot di Cloudflare sul suo sito ricominciava all'infinito. Le sue offerte arrivano comunque in parte da Jooble, che lo aggrega. Per seguirlo direttamente si può creare un Google Alert, per esempio `redattore site:it.indeed.com`, e aggiungerne il feed RSS al profilo come quello già presente.

- **Quale browser:** Chrome o Edge se ci sono, altrimenti un altro browser basato su Chromium installato (Chromium, Brave, Vivaldi…). Se non ce n'è nessuno, `npm run browser:install` scarica il Chromium di Playwright, circa 150 MB.
- **Prima esecuzione:** si apre una finestra del browser. Se il sito mostra la verifica "non sono un robot", risolvila a mano nella finestra (hai 2 minuti) e il programma prosegue da solo. Il profilo del browser è salvato in `.job-searcher/browser`, quindi le volte successive la verifica di solito non ricompare.
- **Superare la verifica con calma:** `node src/cli.js browser` apre il browser del programma su InfoJobs. Risolvi la verifica, fai una ricerca qualsiasi e chiudi la finestra: i cookie restano per le ricerche successive.
- **Più lente delle altre fonti:** tra una pagina e l'altra fanno pause di 3–6 secondi.
- **Se un sito cambia struttura** e non viene riconosciuta nessuna offerta, la pagina viene salvata in `.job-searcher/debug/` e il riepilogo lo segnala: quel file serve per aggiornare il riconoscimento.
- **Variabili d'ambiente** (nel file `.env`):
  - `JOB_SEARCHER_HEADLESS=1` nasconde la finestra (utile con cron), ma in quel caso la verifica anti-robot non si può risolvere;
  - `JOB_SEARCHER_BROWSER=msedge` usa Edge invece di Chrome;
  - `JOB_SEARCHER_BROWSER_PATH=/percorso/del/browser` usa un altro browser basato su Chromium (Brave, Chromium…);
  - `JOB_SEARCHER_BROWSER_ARGS="--opzione …"` passa opzioni in più a Chrome (sostituiscono quelle per WSL);
  - `INFOJOBS_SEARCH_URL` cambia l'indirizzo della ricerca su InfoJobs (vedi sotto).
- **Da sapere:** i termini d'uso di InfoJobs non consentono la lettura automatica. Per questo la fonte è disattivata di default e si attiva con `"enableSources": ["infojobs"]` nel profilo; la procedura guidata lo chiede. Per un uso personale, con poche richieste, il rischio pratico è basso, ma la scelta è tua.

**Su WSL (Linux dentro Windows).** Le finestre delle app Linux passano da WSLg, e con Chrome capita che compaia solo l'icona nella barra, senza finestra. Su WSL il programma avvia Chrome con `--disable-gpu --ozone-platform=x11`, che di solito risolve. Per controllare, usa `node src/cli.js browser`. Se la finestra ancora non si vede:
- aggiorna WSL da Windows con `wsl --update` e riavvialo con `wsl --shutdown`;
- prova altre opzioni, per esempio `JOB_SEARCHER_BROWSER_ARGS="--disable-gpu"` oppure `JOB_SEARCHER_BROWSER_ARGS="--disable-gpu --ozone-platform=wayland"`;
- se non ne vale la pena, lascia InfoJobs fuori dal profilo, oppure cerca con `--no-browser`.

**InfoJobs: indirizzo della ricerca.** Il programma riconosce le offerte in tre modi:
- dati strutturati JSON-LD;
- dati della pagina;
- in mancanza, i link alle schede delle offerte.

L'indirizzo predefinito della ricerca non è stato provato sul sito vero. Se InfoJobs restituisce sempre 0 offerte:
1. fai una ricerca a mano sul sito, per esempio "redattore" a "Padova";
2. copia l'indirizzo dalla barra del browser;
3. sostituisci la parola cercata con `{keyword}` e la città con `{place}`;
4. mettilo in `INFOJOBS_SEARCH_URL` nel file `.env`, oppure in `"infojobsUrl"` nel target del profilo.

### Controllare le fonti: `doctor`

```bash
node src/cli.js doctor                          # fonti base
node src/cli.js doctor -p redattore-padova      # le fonti e le parole di un profilo
node src/cli.js doctor -s infojobs,linkedin      # solo alcune (InfoJobs apre il browser)
```

`doctor` fa una ricerca di prova con una sola parola, un solo luogo e una sola pagina su ogni fonte. Per ciascuna dice se funziona, se non restituisce nulla, se è in errore o se è stata saltata perché manca una chiave. Con un profilo (`-p`) dice anche quanti risultati sono pertinenti, cioè passerebbero i filtri, e mostra come esempio uno di questi. Se in zona non trova nulla, riprova con le parole del remoto: così un sito in inglese non risulta vuoto solo perché ha cercato "redattore". Per le pagine "lavora con noi" indica quale pagina ha usato e come l'ha trovata. Se un servizio risponde in un formato diverso da quello atteso lo segnala, invece di mostrare semplicemente 0 risultati. Se una fonte non trova nulla, `doctor` riprova con una parola comunissima (per esempio "impiegato"). Così distingue una fonte che funziona ma non ha offerte per quella parola da una che non funziona. Quando qualcosa non va aggiunge un suggerimento: chiave sbagliata, sito che blocca le richieste, indirizzo cambiato, troppe richieste. Per LinkedIn prova anche il download dei dettagli. Con `-f json` produce il riepilogo completo, utile per segnalare un problema.

Se un portale non risponde o cambia formato, la ricerca continua con gli altri. Nel riepilogo vedi quali fonti hanno funzionato, quante offerte hanno restituito e quante ne sono state tenute.

## Il profilo di ricerca

Un profilo è un file JSON dentro `profiles/`. Di solito si crea con `profile new` (vedi sopra) e poi, se serve, si ritocca a mano.

```jsonc
{
  "name": "Redattore casa editrice",
  "keywords": ["redattore", "redattrice", "editor", "correttore di bozze"],   // almeno una deve comparire
  "relatedKeywords": ["impaginat*", "traduttore"],  // (opz.) ruoli affini: tengono l'offerta ma con meno punti
  "languages": ["italiano", "italian", "inglese", "english"], // (opz.) scarta chi chiede altre lingue nel titolo
  "searchKeywords": ["redattore", "editor"],        // (opz.) parole cercate sui portali; default: keywords
  "enableSources": ["infojobs"],                   // (opz.) fonti disattivate di default da usare
  "excludeKeywords": ["video", "software"],        // scarta le offerte che le hanno nel TITOLO
  "boostKeywords": ["casa editrice", "libri"],     // alzano il punteggio (non obbligatorie)
  "matchIn": "title",                              // oppure "title+description" (più risultati, più rumore)
  "maxAgeDays": 30,                                 // ignora offerte più vecchie
  "maxPages": 2,                                    // pagine di risultati per ogni ricerca
  "targets": [
    { "type": "area", "label": "Padova, Vicenza e dintorni", "places": ["Padova", "Vicenza"], "radiusKm": 35 },
    {
      "type": "remote",
      "label": "Full remote",
      "keywords": ["copy editor", "proofreader"],  // si aggiungono a quelle generali
      "acceptedRegions": ["worldwide", "anywhere", "europe", "eu", "italy", "italia"]
    }
  ],
  "customSources": []
}
```

- **Parole chiave**: maiuscole e accenti non contano. Si cercano parole intere, quindi "editor" non trova "editoriale". Con `*` finale si cerca un prefisso: `redatt*` trova sia "redattore" sia "redattrice". Le parole con `*` servono solo al filtro locale, perché i portali non le capiscono.
- **Target `area`**: una o più località (`place` oppure `places`) con un raggio. Molti portali non rispettano il raggio: cercando "Padova", LinkedIn restituisce offerte di tutta Italia. Per questo il programma riconosce da solo la località di ogni offerta ("Abano Terme", "Provincia di Vicenza", "Castelfranco Veneto, Provincia di Treviso"…) usando le coordinate di tutti i comuni italiani, e tiene solo quelle entro il raggio o nella stessa provincia di uno dei luoghi cercati. Se l'offerta indica solo la regione (es. "Veneto") viene tenuta. Se la località non si riconosce (es. "Italia") viene scartata, a meno di impostare `"unknownLocation": "keep"`. Il filtro per distanza vale per le ricerche in Italia (`"country": "it"`, il default).
- **Target `remote`**: offerte full remote. Un'offerta viene scartata se è riservata a paesi fuori da `acceptedRegions` (per esempio "USA only"); le località italiane vanno bene se tra le regioni c'è "italia". Per le fonti che non dicono se un'offerta è remota si cerca nel testo "full remote", "da remoto" e simili ("smart working" non basta, perché di solito indica un lavoro ibrido).
- **Fonti per target**: con `"sources": ["linkedin", "adzuna"]` dentro un target limiti le fonti usate. Di default si usano tutte quelle compatibili con il tipo di target.
- **Livello, esperienza, contratto e stipendio** (`filters`): il programma ricava dal testo degli annunci:
  - il livello (stage, junior, mid, senior);
  - gli anni di esperienza richiesti ("almeno 3 anni", "3+ years of experience");
  - il tipo di contratto (indeterminato, determinato, autonomo cioè partita IVA/freelance/collaborazione, somministrazione, apprendistato, stage);
  - l'orario (part-time o full-time);
  - lo stipendio ("RAL 28-32k", "1.600 € al mese", "$25 per hour"), con una stima lorda annua.

  Queste informazioni compaiono nei risultati, nel report, nel CSV e nelle notifiche. Nel profilo si possono usare per filtrare:

  ```json
  "filters": {
    "maxYearsRequired": 10,
    "excludeSeniority": ["stage"],
    "excludeContracts": ["stage", "apprendistato"],
    "minSalary": 22000
  }
  ```

  Un'informazione che nell'annuncio non c'è non fa mai scartare l'offerta. Un contratto viene escluso solo se tutti quelli citati sono tra gli esclusi ("somministrazione finalizzata al tempo indeterminato" resta). `minSalary` è lordo annuo in euro (`salaryCurrency` per un'altra valuta). La procedura guidata imposta i filtri in base agli anni di esperienza.
- **Punteggio**: una parola chiave nel titolo vale 10 punti, nella descrizione 2. Un ruolo affine vale 5 punti (una volta sola), quindi resta sotto i ruoli principali. Una parola "boost" vale 5 punti nel titolo e 2 altrove (azienda compresa, quindi ci si possono mettere i nomi degli editori preferiti). Le offerte sono ordinate per punteggio e poi per data.
- **Lingue**: con `languages` si scartano le offerte che nel titolo chiedono una lingua diversa da quelle indicate, per esempio "Hebrew Localization Specialist" o "English to Korean Translator". Senza `languages` la regola non si applica.
- **Descrizioni di LinkedIn**: nei risultati di ricerca LinkedIn mostra solo titolo, azienda e luogo. Per le offerte che passano il filtro sul titolo il programma scarica anche la descrizione (al massimo 40 per ricerca, modificabile con `maxEnrich` nel target), così può assegnare i punti bonus. Nelle offerte "da remoto" segnala `possibile ibrido` se la descrizione parla di lavoro ibrido o in ufficio.
- **`searchKeywords` e `keywords` sono due cose diverse**: le prime sono le ricerche inviate ai portali (poche, perché ogni parola è una richiesta per fonte e per luogo); le seconde decidono quali risultati tenere. Molti portali restituiscono offerte generiche, ed è il filtro locale a scartarle.

### Il profilo incluso

`profiles/redattore-padova.json` è pensato per una redattrice/un redattore con 5 anni di esperienza in una casa editrice scientifica (revisione bozze, rapporti con gli autori, coordinamento di progetti editoriali, impaginazione in InDesign) e con una laurea magistrale in linguistica:

- **ruoli principali**: redazione, editor, coordinamento editoriale, correzione e revisione di bozze e testi, i ruoli dell'editoria scientifica internazionale (journal, peer review, manuscript, publishing: Assistant/Managing/Production Editor, Peer Review Coordinator, Journal Manager, Associate Publisher…) e il medical/scientific writing;
- **lingue**: italiano e inglese;
- **periodo**: 60 giorni per Padova/Vicenza, dove le offerte sono poche; 30 per il remoto;
- **ruoli affini**, con meno punti: impaginazione/InDesign, traduzione e localizzazione, ruoli per linguisti;
- **esclusi**: stage, tirocini e apprendistato (non adatti a 5 anni di esperienza), ruoli commerciali ("promotore editoriale", "agente", sales), video, SEO/social media, ruoli tecnici;
- **bonus**: contesto scientifico e accademico (riviste, STM, medicina, università) ed editori scientifici/universitari, internazionali (Elsevier, Springer, Wiley, MDPI, Frontiers…) e del territorio (Piccin, Cedam, CLEUP, Il Poligrafo, Neri Pozza, Marsilio…).

- **fonti in più**: un Google Alert su "redattore" e le pagine delle offerte di Springer Nature ed Elsevier (vedi sotto, [Siti delle aziende e piattaforme di selezione](#siti-delle-aziende-e-piattaforme-di-selezione)). Le pagine "lavora con noi" delle case editrici del territorio (Piccin, CLEUP, Neri Pozza, Marsilio, libreriauniversitaria.it) sono state provate, ma nessuna pubblica le offerte online, quindi non sono nel profilo.

Le opzioni da riga di comando `-k`, `-l` e `--remote` sostituiscono quelle del profilo. `-x` si aggiunge alle esclusioni del profilo.

### Perché un'offerta non compare?

Durante la ricerca, per ogni fonte vedi quante offerte sono state scartate e per quale motivo, per esempio `LinkedIn: 11 pertinenti su 60 (scartate: 40 fuori zona, 9 nessuna parola chiave)`. Con `--explain`, o aprendo la sezione "Scartate" del report HTML, vedi quali offerte sono state scartate. Così capisci se conviene allargare il raggio, aggiungere parole chiave o togliere un'esclusione.

## Aggiungere altri portali o siti

### 1. Senza programmare: `customSources` nel profilo

**Feed RSS/Atom**, per esempio un Google Alert, un blog di annunci o la sezione "lavora con noi" di un editore:

```json
{
  "type": "rss",
  "name": "google-alert-redattore",
  "label": "Google Alert redattore",
  "url": "https://www.google.com/alerts/feeds/XXXX/YYYY",
  "supports": ["area"]
}
```

> Suggerimento: su [google.com/alerts](https://www.google.com/alerts) crea un avviso tipo `"redattore" "casa editrice" Padova` e scegli "Invia a: Feed RSS". Così intercetti anche gli annunci pubblicati sui siti degli editori.
>
> Gli elementi di un Google Alert non hanno una località, e il filtro per zona li scarterebbe come "località non riconosciuta". Per questo conviene aggiungere alla fonte `"location": "Padova"`, cioè la città dell'avviso. I link degli alert, che passano da un reindirizzamento di Google, vengono ripuliti automaticamente.

**Pagina HTML** con selettori CSS:

```json
{
  "type": "html",
  "name": "editore-esempio",
  "url": "https://www.editore-esempio.it/lavora-con-noi?q={keyword}",
  "supports": ["area"],
  "selectors": {
    "item": "li.offerta",
    "title": ".titolo",
    "link": "a@href",
    "company": ".azienda",
    "location": ".luogo",
    "date": "time@datetime"
  }
}
```

Nell'URL puoi usare `{keyword}`, `{place}` e `{radiusKm}`. Senza `{keyword}` la pagina viene scaricata una sola volta e poi filtrata in locale. Nei selettori, la forma `selettore@attributo` legge un attributo invece del testo. Una fonte con `"remote": true` segna tutte le sue offerte come remote.

### Siti delle aziende e piattaforme di selezione

Molte aziende, soprattutto le case editrici, pubblicano le offerte solo sul proprio sito. Anche queste fonti si aggiungono in `customSources`, senza programmare.

**Pagine "lavora con noi"** (`careers`): basta l'indirizzo del sito. Se non è già la pagina delle offerte, il programma cerca nella home il link "Lavora con noi" / "Careers" e lo segue. Dalla pagina legge le offerte strutturate (JSON-LD) se ci sono, altrimenti titoli e link. Menu e piè di pagina vengono scartati dal filtro sulle parole chiave, che guarda il titolo. `location` è la sede dell'azienda e serve al filtro per zona.

```json
{
  "type": "careers",
  "name": "editori-veneto",
  "label": "Case editrici del Veneto",
  "pages": [
    { "company": "Piccin Nuova Libraria", "url": "https://www.piccin.it", "location": "Padova" },
    { "company": "Neri Pozza", "url": "https://www.neripozza.it", "location": "Vicenza" }
  ]
}
```

La pagina delle offerte si cerca, in quest'ordine:
1. tra i link della home, preferendo "Lavora con noi" e "Careers" a indizi più vaghi come "Opportunità";
2. nella mappa del sito (`sitemap.xml`);
3. tra gli indirizzi più comuni (`/lavora-con-noi`, `/careers`…).

Se non si trova, forse l'azienda non ha una pagina offerte. Se invece esiste con un indirizzo insolito, indicalo aggiungendo `"direct": true` alla pagina. Se una pagina non funziona, le altre vengono lette lo stesso e il riepilogo segnala quella che non va.

Alcuni siti hanno un certificato HTTPS configurato male: manca il certificato "intermedio" e Node rifiuta la connessione, mentre i browser la accettano. Il programma fa come i browser: scarica il certificato mancante dall'indirizzo indicato nel certificato del sito e verifica la catena completa, senza disattivare nessun controllo di sicurezza.

**Piattaforme di selezione (ATS).** Le grandi aziende, compresi gli editori scientifici internazionali, usano piattaforme con interfacce pubbliche e stabili. Il nome dell'azienda si legge nell'indirizzo della sua pagina delle offerte.

| Piattaforma | Indirizzo tipico della pagina offerte | Configurazione |
|---|---|---|
| Workday | `https://acme.wd3.myworkdayjobs.com/AcmeCareers` | `{ "type": "workday", "name": "acme", "employer": "Acme", "url": "<quell'indirizzo>" }` |
| Greenhouse | `https://boards.greenhouse.io/acme` | `{ "type": "greenhouse", "name": "acme", "board": "acme" }` |
| Lever | `https://jobs.lever.co/acme` (o `jobs.eu.lever.co`) | `{ "type": "lever", "name": "acme", "company": "acme" }` (aggiungi `"region": "eu"` per l'indirizzo europeo) |
| SmartRecruiters | `https://jobs.smartrecruiters.com/Acme` | `{ "type": "smartrecruiters", "name": "acme", "company": "Acme" }` |

Tutte queste fonti funzionano sia per le zone sia per il full remote. Un'offerta remota viene riconosciuta quando la piattaforma lo indica (per esempio "Remote - Europe").

### 2. Con un modulo JavaScript

Crea un file in `src/sources/`, ispirandoti a `remotive.js`, che è il più semplice:

```js
export default {
  name: 'miosito',
  label: 'Mio Sito',
  supports: ['area', 'remote'],   // per quali tipi di target ha senso
  env: ['MIOSITO_API_KEY'],       // (opz.) variabili d'ambiente richieste
  async search({ keywords, target, maxAgeDays, maxPages, warn }) {
    // target.place, target.radiusKm, target.country, target.type
    // restituisce un array di makeJob('miosito', { id, title, company, location, url, postedAt, description, remote })
  },
};
```

Poi registralo in `src/sources/index.js`. Conviene separare una funzione `parse()` pura e testarla con un file d'esempio in `test/fixtures/`, come fanno le altre fonti.

## Quali offerte scegliere (con l'aiuto di Claude)

Quando i risultati sono tanti, Claude può confrontarli con il CV: li ordina per affinità, spiega punti di forza e lacune per le migliori, segnala quelle da evitare e, se vuoi, scrive le lettere di presentazione. Anche qui si usa l'abbonamento su claude.ai, non l'API: il programma prepara soltanto il testo.

```bash
node src/cli.js match -p redattore-padova                   # le 15 offerte migliori dell'ultima ricerca
node src/cli.js match -p redattore-padova --top 8 -o match.txt
node src/cli.js match -p redattore-padova --ids 3359919,4a00168
node src/cli.js match -p redattore-padova --cv ~/Documenti/cv.pdf   # include il testo del CV
```

Senza `--cv`, allega il PDF del CV nella chat. Le offerte sono quelle dell'ultima ricerca del profilo, senza quelle segnate `scartata` o `rifiutata`. Claude le chiama con lo stesso codice tra parentesi quadre, quindi poi puoi segnarle con `track`. Dall'interfaccia web c'è il pulsante «Prompt per Claude» nella pagina Offerte.

## Case editrici, aziende affini e candidature spontanee

Molte case editrici e studi editoriali non pubblicano offerte e non hanno una pagina «lavora con noi»: ci si candida di propria iniziativa. Il programma aiuta a trovarli e a seguire le candidature.

**Non solo case editrici: i settori affini.** Le stesse competenze servono anche dove il ruolo ha un altro nome. Un'agenzia che impagina cataloghi e libretti per le sagre cerca chi sa correggere bozze e usare InDesign, anche se non lo chiama «redattore». La tabella `src/publishers/sectors.js` elenca questi settori, e per ognuno dice perché è affine, che ruoli proporre e come cercarlo:
- editoria: case editrici, studi e servizi editoriali, librerie e librerie universitarie;
- settori affini: agenzie pubblicitarie e di comunicazione, tipografie e prestampa, agenzie di traduzione, comunicazione medico-scientifica, università ed enti di ricerca, musei, e-learning, documentazione tecnica, testate giornalistiche.

I settori vengono ordinati in base al profilo e al CV salvato: `publishers sectors -p <profilo>` mostra quelli consigliati, con il motivo. Per ogni azienda si può segnare il **ruolo da proporre**. Il CV su misura ne tiene conto: valorizza ciò che conta in quel settore e racconta le esperienze editoriali con le sue parole.

```bash
node src/cli.js publishers sectors -p redattore-padova            # settori affini consigliati e perché
node src/cli.js publishers find -l Padova --sectors affini --add   # cerca nei settori consigliati
node src/cli.js publishers find -l Padova --sectors agenzia-comunicazione,tipografia
node src/cli.js publishers prompt -l Padova --sectors affini -o affini.txt   # Claude propone settori e aziende dal CV
```

`--sectors` accetta `editoria` (il valore predefinito: case editrici, studi e librerie), `affini`, `tutti` o un elenco di settori.

- **Trovare:** ci sono tre modi, da combinare, attorno a una o più città (`-l "Padova,Venezia"`).
  1. **OpenStreetMap e Wikidata:** dati aperti, pensati per essere interrogati. Coprono bene gli editori noti, ma molti piccoli editori indipendenti non ci sono. Da Wikidata si tengono solo le case editrici con il sito ufficiale e fondate dal 1800 in poi: altrimenti arriverebbero anche gli stampatori storici (a Venezia, decine del Cinquecento e del Seicento). Se ne avevi già aggiunti, `publishers clean` (o il pulsante «Toglile» nella pagina web) toglie le voci di Wikidata senza sito che non hai ancora toccato.
  2. **Ricerca web (facoltativa):** con l'API di [Brave Search](https://brave.com/search/api/) cerca le frasi di ogni settore scelto, come "casa editrice Venezia", "studio editoriale Padova" o "agenzia di comunicazione Padova". Scarta grandi catene e negozi online, social ed elenchi. Serve una chiave, gratuita fino a qualche migliaio di ricerche al mese, da mettere in `.env` come `BRAVE_SEARCH_API_KEY=…`. Si usano 2-3 frasi per settore e per città.
  3. **Con Claude o da un elenco:** `publishers prompt` prepara un testo che chiede a Claude le case editrici e gli studi editoriali della zona, piccoli compresi. Con `--sectors affini` Claude parte dal CV: elenca le competenze trasferibili, propone settori affini (anche meno ovvi) e aziende della zona, ognuna con il ruolo da proporre e il motivo. La risposta si importa con `publishers import`. Si può importare anche un elenco scritto a mano, una per riga (`Nome | sito | città`). Prima di aggiungerle il programma visita ogni sito: quelle inventate o chiuse risultano «sito non raggiungibile».
- **Capire chi sono:** «controlla sito» visita la home e ricava la specializzazione (bambini e ragazzi, scientifica, scolastica, narrativa…), l'email migliore per candidarsi (prima lavoro@, hr@, cv@, poi redazione@, poi info@) e il link alla pagina «lavora con noi», se c'è.
- **Seguire:** ogni casa editrice ha uno stato: da valutare, da contattare, candidatura inviata, sollecito inviato, colloquio, risposta negativa, nessuna risposta, non mi interessa. Poi la data di invio e le note. Tre settimane dopo l'invio senza risposta viene segnata «da sollecitare».

```bash
node src/cli.js publishers find -l "Padova,Venezia" -r 40   # anteprima dei risultati
node src/cli.js publishers find -l Padova -r 40 --add    # li aggiunge all'elenco ("da valutare")
node src/cli.js publishers check                         # visita i siti non ancora controllati
node src/cli.js publishers prompt -l "Padova,Venezia" -r 40 -o editori-prompt.txt
node src/cli.js publishers import risposta.txt           # risposta di Claude o elenco, e controllo dei siti
node src/cli.js publishers add "Edizioni Esempio" --site esempio.it --city Vicenza --note "conosco la redattrice"
node src/cli.js publishers                               # elenco: prima quelle da sollecitare
node src/cli.js publishers edizioni-esempio inviata --date 2026-09-29 --note "CV a lavoro@esempio.it"
node src/cli.js publishers edizioni-esempio sollecitata
```

`editori` è un sinonimo di `publishers`. I dati sono in `.job-searcher/publishers.json`. Nell'interfaccia web c'è la pagina **Case editrici**, con i filtri per stato e specializzazione. In «Cerca nuove» ci sono due schede. In «Mappe e web» si scelgono i settori, con quelli consigliati per il profilo in evidenza. In «Con Claude o da un elenco» si può chiedere a Claude di proporre le case editrici oppure le aziende affini al CV.

## Analisi del mercato

Cosa chiedono davvero gli annunci trovati per un profilo, e come si confronta il tuo CV:
- **competenze e strumenti**, con la percentuale di annunci che li nominano: InDesign, correzione di bozze, LaTeX, SEO…;
- **lingue**, con il livello tipico richiesto;
- **esperienza, contratti e stipendi**, quando gli annunci li indicano;
- **lacune**: quello che molti annunci chiedono e che il CV non nomina. Ognuna ha una priorità, che dipende da quanto spesso compare, i modi per colmarla (risorse, spesso gratuite, e tempo indicativo) e il modo di mostrarla nel CV o in un portfolio.

Le caratteristiche di ogni offerta si accumulano a ogni ricerca in `.job-searcher/market-<profilo>.json`, per gli ultimi 180 giorni. Più ricerche fai, più i numeri sono affidabili. Si contano solo gli annunci con una descrizione. Il catalogo delle competenze, con le risorse, è in `src/market/catalog.js`.

```bash
node src/cli.js market -p redattore-padova             # l'analisi nel terminale
node src/cli.js market -p redattore-padova --prompt    # testo per farsi fare da Claude un piano personale
```

Il prompt passa a Claude i dati e il CV. Claude distingue i requisiti che fanno scartare da quelli graditi e propone un piano di 4-8 settimane con risorse concrete, senza inventarle. Suggerisce anche progetti da portfolio e il modo di valorizzare nel CV quello che sai già fare. Nell'interfaccia web è la pagina **Mercato**, con il pulsante «Piano personale con Claude».

## Sorvegliare le aziende

Molte case editrici e aziende pubblicano un annuncio solo sul proprio sito, e per pochi giorni. La sorveglianza controlla le aziende dell'elenco e segnala:
- **annunci nuovi** nella pagina «lavora con noi», con una ★ quelli che corrispondono alle parole chiave del profilo;
- **avvisi** comparsi nella home, come «cerchiamo», «stiamo cercando» o «posizioni aperte»;
- **una pagina «lavora con noi» comparsa**, dove prima non c'era;
- **una pagina «lavora con noi» cambiata**, anche senza annunci riconosciuti.

La prima volta salva solo un'istantanea di ogni pagina: le novità si vedono dal controllo successivo. Le aziende segnate «non mi interessa» o «risposta negativa» non vengono controllate.

```bash
node src/cli.js publishers watch -p redattore-padova            # controlla ora
node src/cli.js publishers auto -p redattore-padova --notify    # il giro della GitHub Action
```

`publishers auto` ripete la ricerca delle aziende ogni 7 giorni (`--every` per cambiare) e sorveglia ogni volta. Poi, con `--notify`, manda un unico messaggio con le novità e le aziende nuove. Zona e settori sono quelli del profilo: le città dei target «area», il loro raggio (al massimo 50 km) e «editoria,affini». Per cambiarli aggiungi al profilo:

```json
"publishers": { "places": ["Padova", "Venezia"], "radiusKm": 40, "sectors": "editoria,affini" }
```

Nell'interfaccia web, in cima alla pagina «Case editrici e aziende affini», c'è il riquadro **Novità dalle aziende seguite** con il pulsante «Controlla ora». Lo stato della sorveglianza è in `.job-searcher/watch.json`.

## CV su misura

Lo stesso CV non va bene per tutti. Per un editore di libri per bambini conviene valorizzare il processo editoriale, i rapporti con autori e illustratori e l'impaginazione in InDesign, più dei contenuti scientifici curati. Per un editore accademico vale il contrario. Il lavoro è diviso in due parti:

1. **Lo strumento** (`src/tailor.js`, senza intelligenza artificiale) riconosce la specializzazione del destinatario, dal sito della casa editrice o dal testo dell'annuncio. Da una tabella (`src/publishers/specialties.js`) decide cosa mettere in primo piano e cosa in secondo.
2. **Il prompt** unisce il CV, il destinatario e queste indicazioni. Lo incolli su claude.ai, o in un altro assistente, che riscrive il CV senza inventare nulla. Per le candidature spontanee scrive anche l'email di accompagnamento.

```bash
node src/cli.js cv set ~/Documenti/cv.pdf        # salva il testo del CV (resta sul computer)
node src/cli.js cv tailor edizioni-esempio        # per una casa editrice dell'elenco
node src/cli.js cv tailor 3359919 -o cv-prompt.txt  # per un'offerta (codice tra [ ])
```

Nell'interfaccia web il pulsante **CV su misura** c'è su ogni offerta e su ogni casa editrice. Il CV caricato nella creazione del profilo viene ricordato; il testo resta in `.job-searcher/cv.txt`.

## Struttura del codice

```
src/
  cli.js           riga di comando
  doctor.js        controllo delle fonti
  tls-chain.js     completamento dei certificati HTTPS incompleti
  notify.js        riepilogo delle offerte nuove su Telegram ed email
  config.js        lettura e validazione del profilo
  search.js        orchestrazione: fonti → filtro → deduplica → ordinamento
  filter.js        corrispondenza delle parole chiave, punteggio, controllo di zona e remoto
  geo.js           riconoscimento delle località italiane e calcolo delle distanze
  dedupe.js        unione delle offerte doppie
  store.js         memoria delle offerte già viste (.job-searcher/)
  tracking.js      candidature e ultimi risultati
  match.js         testo per confrontare CV e offerte su claude.ai
  tailor.js        CV su misura: cosa valorizzare e testo per claude.ai
  market/          analisi del mercato: competenze richieste, lacune e come colmarle
  publishers/      case editrici e aziende affini: archivio, settori, ricerca (OpenStreetMap, Wikidata, web),
                   specializzazioni, sorveglianza dei siti (watch.js) e giro automatico (auto.js)
  commands/        comandi publishers e cv della riga di comando
  extract.js       livello, esperienza, contratto e stipendio ricavati dal testo
  app.js           percorso completo di una ricerca (usato da riga di comando e interfaccia web)
  paths.js         dove stanno i file (JOB_SEARCHER_HOME)
  job.js           formato comune di un'offerta
  browser.js       browser vero (Playwright) per InfoJobs
  profiles/        archivio dei profili, analisi del CV, procedura guidata, prompt per claude.ai, aree professionali (roles.js)
  sources/         un modulo per portale + fonti generiche (rss, html, careers, piattaforme di selezione)
  output/          terminale, HTML, CSV, JSON
data/comuni.json   comuni italiani con coordinate (rigenerabile con npm run build:comuni)
test/              test (npm test) con file d'esempio in test/fixtures/
web/               interfaccia web (Next.js)
```

Il cuore del programma non dipende dalla riga di comando: il percorso completo di una ricerca è in `app.js` (`searchProfile`) e lo usano sia `cli.js` sia l'interfaccia web.

## Sviluppo

```bash
npm test                         # test con il test runner integrato in Node
npm run format                   # formatta e sistema import e piccoli problemi (Biome)
npm run lint                     # controllo di formattazione e linter, come in CI
```

Formattazione e linter sono di [Biome](https://biomejs.dev), configurato in `biome.json`: controlla anche l'interfaccia web. Con l'estensione Biome per VS Code la formattazione avviene al salvataggio.

Per ricevere ogni giorno le offerte nuove vedi [Ricerca automatica ogni giorno](#ricerca-automatica-ogni-giorno-github-actions).
