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

La ricerca "redattore casa editrice, zona Padova/Vicenza oppure full remote in tutto il mondo" è già pronta:

```bash
npm run search
```

È come scrivere `node src/cli.js search --profile profiles/redattore-padova.json`. Il comando:

1. interroga i portali per Padova e Vicenza (raggio 35 km) e per le offerte full remote;
2. tiene solo le offerte pertinenti e dà loro un punteggio (e per ogni fonte ti dice quante ne ha scartate e perché);
3. unisce i duplicati trovati su portali diversi;
4. stampa i risultati e salva un report HTML in `reports/`, con un filtro testuale e l'opzione "solo nuove".

Altri esempi:

```bash
# ricerca veloce senza profilo
node src/cli.js search -k "redattore,editor,correttore di bozze" -l "Padova,Vicenza" -r 40 --remote

# mostra anche le offerte scartate e il motivo (utile per regolare il profilo)
node src/cli.js search -p profiles/redattore-padova.json --explain

# solo le offerte mai viste prima, salvate anche in CSV (apribile con Excel)
node src/cli.js search -p profiles/redattore-padova.json --only-new -o offerte.csv

# solo alcune fonti
node src/cli.js search -p profiles/redattore-padova.json -s linkedin,remotive

# elenco delle fonti e del loro stato (es. chiave API mancante)
node src/cli.js sources

node src/cli.js --help
```

Per installare il comando `job-searcher` globalmente, esegui `npm link`.

## Fonti incluse

| Fonte | Zona geografica | Full remote | Note |
|---|---|---|---|
| LinkedIn | ✓ | ✓ | pagina pubblica delle offerte, senza login. Spesso ignora la località (i risultati vengono filtrati per distanza) e, se si fanno troppe richieste, risponde con errore 429 |
| Indeed | ✓ | ✓ | **da attivare** (`"enableSources": ["indeed"]`, già attiva nel profilo incluso). Usa un vero browser: vedi sotto |
| Adzuna | ✓ | ✓ | aggregatore con API gratuita, copre l'Italia (per il remoto cerca offerte italiane che citano il lavoro da remoto). Richiede `ADZUNA_APP_ID` e `ADZUNA_APP_KEY` |
| Jooble | ✓ | | aggrega molti portali italiani (InfoJobs, Indeed, siti aziendali…). Richiede `JOOBLE_API_KEY`; se dà sempre 0 risultati prova `JOOBLE_HOST=it.jooble.org` |
| Remotive | | ✓ | API pubblica |
| Remote OK | | ✓ | API pubblica |
| Jobicy | | ✓ | API pubblica |
| Himalayas | | ✓ | API pubblica |
| We Work Remotely | | ✓ | feed RSS |

Le fonti che richiedono una chiave vengono **saltate** se la chiave manca: la ricerca funziona lo stesso. Consiglio comunque di registrarti gratis su Adzuna e Jooble, perché sono il modo più affidabile per coprire i portali italiani. InfoJobs e Subito bloccano le letture automatiche delle loro pagine.

### Indeed

Indeed non ha un'API pubblica e blocca gli script con Cloudflare, quindi questa fonte apre **Chrome** (tramite Playwright, installato da `npm install`) e legge le pagine dei risultati come farebbe una persona.

- **Prima esecuzione**: si apre una finestra di Chrome. Se Indeed mostra la verifica "non sono un robot", risolvila a mano nella finestra (hai 2 minuti): il programma poi prosegue da solo. Il profilo del browser è salvato in `.job-searcher/indeed-browser`, quindi le volte successive la verifica di solito non ricompare.
- **Più lenta delle altre fonti**: tra una pagina e l'altra fa pause di 3–6 secondi, perché Indeed è molto sensibile al traffico automatico.
- **Variabili d'ambiente** (nel file `.env`):
  - `INDEED_HEADLESS=1` nasconde la finestra (utile con cron), ma la verifica anti-robot in quel caso non si può risolvere;
  - `INDEED_BROWSER=msedge` usa Edge invece di Chrome;
  - `INDEED_BROWSER_PATH=/percorso/del/browser` usa un altro browser basato su Chromium (Brave, Chromium…);
  - `INDEED_HOST=it.indeed.com` cambia il dominio del paese.
- **Da sapere**: i termini d'uso di Indeed non consentono la lettura automatica del sito. Per questo la fonte è disattivata di default. Per un uso personale, con poche richieste, il rischio pratico è basso, ma la scelta è tua. Per disattivarla togli `"enableSources": ["indeed"]` dal profilo, oppure usa `-s` per scegliere le fonti.

Se un portale non risponde o cambia formato, la ricerca continua con gli altri. Nel riepilogo vedi quali fonti hanno funzionato, quante offerte hanno restituito e quante ne sono state tenute.

## Il profilo di ricerca

Un profilo è un file JSON dentro `profiles/`. Per crearne un altro, copia `profiles/redattore-padova.json` e modificalo.

```jsonc
{
  "name": "Redattore casa editrice",
  "keywords": ["redattore", "redattrice", "editor", "correttore di bozze"],   // almeno una deve comparire
  "relatedKeywords": ["impaginat*", "traduttore"],  // (opz.) ruoli affini: tengono l'offerta ma con meno punti
  "languages": ["italiano", "italian", "inglese", "english"], // (opz.) scarta chi chiede altre lingue nel titolo
  "searchKeywords": ["redattore", "editor"],        // (opz.) parole cercate sui portali; default: keywords
  "enableSources": ["indeed"],                     // (opz.) fonti disattivate di default da usare
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

## Struttura del codice

```
src/
  cli.js           riga di comando
  config.js        lettura e validazione del profilo
  search.js        orchestrazione: fonti → filtro → deduplica → ordinamento
  filter.js        corrispondenza delle parole chiave, punteggio, controllo di zona e remoto
  geo.js           riconoscimento delle località italiane e calcolo delle distanze
  dedupe.js        unione delle offerte doppie
  store.js         memoria delle offerte già viste (.job-searcher/)
  job.js           formato comune di un'offerta
  sources/         un modulo per portale + fonti generiche rss/html
  output/          terminale, HTML, CSV, JSON
data/comuni.json   comuni italiani con coordinate (rigenerabile con npm run build:comuni)
test/              test (npm test) con file d'esempio in test/fixtures/
```

Il cuore (`config.js`, `search.js` e le fonti) non dipende dalla CLI. Se in futuro vuoi un'interfaccia web, per esempio con Next.js, basta importare `resolveProfile` e `runSearch` in una route API.

## Sviluppo

```bash
npm test                         # test con il test runner integrato in Node
npx prettier --write "src/**/*.js" "test/*.js"
```

Per ricevere ogni giorno le offerte nuove puoi pianificare `npm run search -- --only-new` con cron (Linux/macOS) o con l'Utilità di pianificazione (Windows).
