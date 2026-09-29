'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const BusyContext = createContext({ setDetail: () => {} });

/** Mostra un dettaglio sotto la scritta del caricamento, per esempio l'avanzamento della ricerca. */
export function useBusy() {
  return useContext(BusyContext);
}

/** Rotella di caricamento. */
export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

// biome-ignore format: tabella più leggibile su una riga per voce
const LABELS = [
  [/^\/api\/search$/, 'Cerco le offerte'],
  [/^\/api\/match$/, 'Preparo il confronto con il CV'],
  [/^\/api\/why$/, 'Provo le ricerche su LinkedIn'],
  [/^\/api\/kit$/, 'Preparo il kit di candidatura', 'POST'],
  [/^\/api\/publishers\/discover$/, 'Cerco case editrici e aziende'],
  [/^\/api\/publishers\/import$/, 'Importo l\'elenco e visito i siti'],
  [/^\/api\/publishers\/watch$/, 'Controllo i siti delle aziende', 'POST'],
  [/^\/api\/publishers\/cleanup$/, 'Faccio pulizia nell\'elenco'],
  [/^\/api\/publishers\/[^/]+\/check$/, 'Visito il sito dell\'azienda'],
  [/^\/api\/profiles\/analyze$/, 'Leggo il CV'],
  [/^\/api\/profiles\/suggest$/, 'Preparo i suggerimenti'],
  [/^\/api\/cv$/, 'Carico il CV'],
  [/^\/api\/(tailor|market\/prompt|publishers\/prompt|profiles\/prompt)$/, 'Preparo il testo per Claude'],
];

/** Scritta da mostrare per una chiamata, o null se la chiamata non riguarda le API dell'app. */
export function busyLabel(input, init) {
  let url;
  let method = init?.method;
  try {
    const raw = typeof input === 'string' ? input : (input?.url ?? String(input));
    url = new URL(raw, window.location.href);
    if (!method && typeof input === 'object' && 'method' in input) method = input.method;
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return null;
  method = (method ?? 'GET').toUpperCase();
  for (const [re, label, only] of LABELS) if (re.test(url.pathname) && (!only || only === method)) return label;
  if (method === 'GET') return 'Carico';
  if (method === 'DELETE') return 'Elimino';
  return 'Salvo';
}

/**
 * Finché c'è una chiamata alle API in corso, la pagina è bloccata (attributo `inert`: niente clic, Tab o Invio)
 * e compare una rotella con quello che sta succedendo. Le chiamate si intercettano su `window.fetch`, così ogni
 * pulsante è coperto senza doverlo ricordare. Le risposte a flusso (la ricerca) tengono il blocco finché il flusso
 * non finisce.
 */
export function BusyProvider({ children }) {
  const [calls, setCalls] = useState([]);
  const [detail, setDetailState] = useState(null);
  const nextId = useRef(0);
  const lastFocus = useRef(null);

  const setDetail = useCallback((text) => setDetailState(text || null), []);

  useEffect(() => {
    const original = window.fetch;
    const start = (label) => {
      const id = ++nextId.current;
      setCalls((prev) => {
        if (!prev.length) lastFocus.current = document.activeElement;
        return [...prev, { id, label }];
      });
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        setCalls((prev) => prev.filter((c) => c.id !== id));
      };
    };
    window.fetch = async (input, init) => {
      const label = busyLabel(input, init);
      if (!label) return original(input, init);
      const end = start(label);
      try {
        const res = await original(input, init);
        const stream = /ndjson|event-stream/.test(res.headers.get('content-type') ?? '');
        if (!stream || !res.body) {
          end();
          return res;
        }
        // Il blocco resta finché chi legge non arriva in fondo (o smette di leggere).
        const reader = res.body.getReader();
        const tracked = new ReadableStream({
          async pull(controller) {
            try {
              const { value, done } = await reader.read();
              if (done) {
                end();
                controller.close();
              } else controller.enqueue(value);
            } catch (err) {
              end();
              controller.error(err);
            }
          },
          cancel(reason) {
            end();
            return reader.cancel(reason);
          },
        });
        return new Response(tracked, { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch (err) {
        end();
        throw err;
      }
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  const busy = calls.length > 0;

  // Mentre si aspetta, Esc non deve chiudere le finestre: si fermano i tasti prima che arrivino alla pagina.
  useEffect(() => {
    if (!busy) {
      setDetailState(null);
      const el = lastFocus.current;
      lastFocus.current = null;
      if (el?.isConnected && document.activeElement === document.body) el.focus({ preventScroll: true });
      return;
    }
    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('keydown', stop, true);
    return () => window.removeEventListener('keydown', stop, true);
  }, [busy]);

  const label = calls.at(-1)?.label;
  return (
    <BusyContext.Provider value={{ setDetail }}>
      <div className="shell" inert={busy} aria-busy={busy}>
        {children}
      </div>
      {busy && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div className="busy-box">
            <Spinner size={22} />
            <div>
              <div className="busy-label">{label}…</div>
              {detail && <div className="busy-detail">{detail}</div>}
            </div>
          </div>
        </div>
      )}
    </BusyContext.Provider>
  );
}
