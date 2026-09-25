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

La ricerca "redattore casa editrice, zona Padova oppure full remote in tutto il mondo" è già pronta:

```bash
npm run search
```

È come scrivere `node src/cli.js search --profile profiles/redattore-padova.json`. Il comando:

1. interroga i portali per Padova (raggio 40 km) e per le offerte full remote;
2. tiene solo le offerte pertinenti e dà loro un punteggio;
3. unisce i duplicati trovati su portali diversi;
4. stampa i risultati e salva un report HTML in `reports/`, con un filtro testuale e l'opzione "solo nuove".

Altri esempi:

```bash
# ricerca veloce senza profilo
node src/cli.js search -k "redattore,editor,correttore di bozze" -l Padova -r 40 --remote

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
| LinkedIn | ✓ | ✓ | pagina pubblica delle offerte, senza login. Se si fanno troppe richieste risponde con errore 429 |
| Adzuna | ✓ | | aggregatore con API gratuita, copre l'Italia. Richiede `ADZUNA_APP_ID` e `ADZUNA_APP_KEY` |
| Jooble | ✓ | | aggrega molti portali italiani (InfoJobs, Indeed, siti aziendali…). Richiede `JOOBLE_API_KEY` |
| Remotive | | ✓ | API pubblica |
| Remote OK | | ✓ | API pubblica |
| Jobicy | | ✓ | API pubblica |
| Himalayas | | ✓ | API pubblica |
| We Work Remotely | | ✓ | feed RSS |

Le fonti che richiedono una chiave vengono **saltate** se la chiave manca: la ricerca funziona lo stesso. Consiglio comunque di registrarti gratis su Adzuna e Jooble, perché sono il modo più affidabile per coprire i portali italiani. Indeed, InfoJobs e Subito bloccano le letture automatiche delle loro pagine.

Se un portale non risponde o cambia formato, la ricerca continua con gli altri. Nel riepilogo vedi quali fonti hanno funzionato, quante offerte hanno restituito e quante ne sono state tenute.

## Il profilo di ricerca

Un profilo è un file JSON dentro `profiles/`. Per crearne un altro, copia `profiles/redattore-padova.json` e modificalo.

```jsonc
{
  "name": "Redattore casa editrice",
  "keywords": ["redattore", "redattrice", "editor", "correttore di bozze"],   // almeno una deve comparire
  "searchKeywords": ["redattore", "editor"],        // (opz.) parole cercate sui portali; default: keywords
  "excludeKeywords": ["video", "software"],        // scarta le offerte che le hanno nel TITOLO
  "boostKeywords": ["casa editrice", "libri"],     // alzano il punteggio (non obbligatorie)
  "matchIn": "title+description",                  // oppure "title" per essere più severi
  "maxAgeDays": 30,                                 // ignora offerte più vecchie
  "maxPages": 2,                                    // pagine di risultati per ogni ricerca
  "targets": [
    { "type": "area", "label": "Padova e dintorni", "place": "Padova", "country": "it", "radiusKm": 40 },
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
- **Target**: sono le zone in cui cercare. `area` indica una località con un raggio. `remote` indica offerte full remote: un'offerta remota viene scartata se è riservata a paesi fuori da `acceptedRegions` (per esempio "USA only").
- **Fonti per target**: con `"sources": ["linkedin", "adzuna"]` dentro un target limiti le fonti usate. Di default si usano tutte quelle compatibili con il tipo di target.
- **Punteggio**: una parola chiave nel titolo vale 10 punti, nella descrizione 2. Una parola "boost" vale 5 punti nel titolo e 2 altrove. Le offerte sono ordinate per punteggio e poi per data.

Le opzioni da riga di comando `-k`, `-l` e `--remote` sostituiscono quelle del profilo. `-x` si aggiunge alle esclusioni del profilo.

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
  filter.js        corrispondenza delle parole chiave, punteggio, controllo del remoto
  dedupe.js        unione delle offerte doppie
  store.js         memoria delle offerte già viste (.job-searcher/)
  job.js           formato comune di un'offerta
  sources/         un modulo per portale + fonti generiche rss/html
  output/          terminale, HTML, CSV, JSON
test/              test (npm test) con file d'esempio in test/fixtures/
```

Il cuore (`config.js`, `search.js` e le fonti) non dipende dalla CLI. Se in futuro vuoi un'interfaccia web, per esempio con Next.js, basta importare `resolveProfile` e `runSearch` in una route API.

## Sviluppo

```bash
npm test                         # test con il test runner integrato in Node
npx prettier --write "src/**/*.js" "test/*.js"
```

Per ricevere ogni giorno le offerte nuove puoi pianificare `npm run search -- --only-new` con cron (Linux/macOS) o con l'Utilità di pianificazione (Windows).
