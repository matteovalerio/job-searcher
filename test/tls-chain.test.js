import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { after, before, test } from 'node:test';
import { getText } from '../src/http.js';
import { setExtraRootCertificates } from '../src/tls-chain.js';

// Catena di prova (test/fixtures/tls): radice -> intermedio -> certificato per "localhost".
// Il server invia solo il proprio certificato, come i siti configurati male.
const fixture = (name) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url));
let server;
let base;

before(async () => {
  server = https.createServer({ key: fixture('leaf.key'), cert: fixture('leaf.pem') }, (req, res) => {
    if (req.url === '/vecchia') {
      res.writeHead(301, { location: '/lavora-con-noi' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h1>Lavora con noi</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `https://localhost:${server.address().port}`;
  setExtraRootCertificates([fixture('root.pem').toString()]);
});

after(() => {
  server.close();
  setExtraRootCertificates([]);
});

test('certificato intermedio mancante: lo scarica e verifica la catena completa', async (t) => {
  const realFetch = globalThis.fetch;
  const aia = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith('http://aia.example.test/')) {
      aia.push(String(url));
      return new Response(fixture('int.der'));
    }
    return realFetch(url, init);
  });
  // Senza radice di prova fidata la catena non si chiude: prima si verifica che fetch da sola fallisca.
  await assert.rejects(realFetch(`${base}/`), (err) => err.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');

  assert.equal(await getText(`${base}/vecchia`), '<h1>Lavora con noi</h1>', 'segue anche il reindirizzamento');
  assert.deepEqual(aia, ['http://aia.example.test/intermedio.crt']);
});

test("se l'intermedio non si trova, errore chiaro e nessuna verifica disattivata", async (t) => {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) =>
    String(url).startsWith('http://aia.example.test/') ? new Response('', { status: 404 }) : realFetch(url, init),
  );
  // Host diverso (127.0.0.1) per non usare l'intermedio già scaricato nel test precedente.
  await assert.rejects(
    getText(base.replace('localhost', '127.0.0.1')),
    /Certificato del sito incompleto e non riparabile.*HTTP 404/,
  );
});

test("una catena che non risale a un'autorità fidata resta rifiutata", async (t) => {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) =>
    String(url).startsWith('http://aia.example.test/') ? new Response(fixture('int.der')) : realFetch(url, init),
  );
  setExtraRootCertificates([]); // la radice di prova non è più fidata
  try {
    await assert.rejects(getText(`${base}/`), /Certificato del sito incompleto e non riparabile/);
  } finally {
    setExtraRootCertificates([fixture('root.pem').toString()]);
  }
});
