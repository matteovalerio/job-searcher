const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} su ${url}`);
    this.status = status;
    this.url = url;
  }
}

/**
 * fetch con timeout, User-Agent da browser e un nuovo tentativo su 429/5xx.
 * @returns {Promise<Response>}
 */
export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        body,
        headers: { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw new Error(`Richiesta fallita (${url}): ${err.cause?.code ?? err.message}`);
    }
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    throw new HttpError(res.status, url);
  }
}

export async function getJson(url, options = {}) {
  const res = await request(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  return res.json();
}

export async function getText(url, options = {}) {
  const res = await request(url, options);
  return res.text();
}

export { sleep };
