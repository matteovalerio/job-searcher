import https from 'node:https';
import tls from 'node:tls';

/*
 * Alcuni siti (anche di case editrici) non inviano il certificato "intermedio" della loro catena HTTPS.
 * I browser lo scaricano da soli dall'indirizzo scritto nel certificato del sito (estensione AIA, "CA Issuers");
 * Node no, e la richiesta fallisce con UNABLE_TO_VERIFY_LEAF_SIGNATURE. Qui si fa lo stesso dei browser:
 * si scarica l'intermedio e si ripete la richiesta con la verifica completa della catena. Non si disattiva
 * nessun controllo: il certificato del sito deve comunque risalire a un'autorità di certificazione fidata.
 */

export const INCOMPLETE_CHAIN = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);

// Autorità aggiuntive: servono solo ai test, che usano una catena di prova.
let extraRoots = [];
export function setExtraRootCertificates(pems) {
  extraRoots = pems;
}

const intermediates = new Map(); // host -> PEM

/** Indirizzo da cui scaricare l'intermedio, letto dal certificato presentato dal sito. */
function issuerUrl(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Qui la verifica è disattivata solo per LEGGERE il certificato: nessun dato viene scambiato con il sito.
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const url = cert?.infoAccess?.['CA Issuers - URI']?.[0];
      if (url) resolve(url);
      else reject(new Error('il certificato del sito non indica dove trovare il certificato intermedio'));
    });
    socket.on('error', reject);
    socket.on('timeout', () => socket.destroy(new Error('tempo scaduto')));
  });
}

function toPem(buffer) {
  const text = buffer.toString('latin1');
  if (text.includes('-----BEGIN CERTIFICATE-----')) return text;
  const b64 = buffer
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

async function intermediateFor(host, port, timeoutMs) {
  if (!intermediates.has(host)) {
    const url = await issuerUrl(host, port, timeoutMs);
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`certificato intermedio non scaricabile (${url}: HTTP ${res.status})`);
    intermediates.set(host, toPem(Buffer.from(await res.arrayBuffer())));
  }
  return intermediates.get(host);
}

function httpsRequest(url, { method, headers, body, timeoutMs, ca }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, ca, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('tempo scaduto')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Ripete una richiesta HTTPS completando la catena del certificato. Segue fino a 5 reindirizzamenti.
 * @returns {Promise<Response>}
 */
export async function fetchCompletingChain(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  let current = new URL(url);
  for (let hop = 0; hop <= 5; hop++) {
    const port = Number(current.port || 443);
    const ca = [...tls.rootCertificates, ...extraRoots, await intermediateFor(current.hostname, port, timeoutMs)];
    const res = await httpsRequest(current, { method, headers, body, timeoutMs, ca });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current);
      if (current.protocol !== 'https:')
        return fetch(current, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      continue;
    }
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers['content-type'] ?? '' },
    });
  }
  throw new Error(`troppi reindirizzamenti (${url})`);
}
