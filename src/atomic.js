import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/*
 * Scrittura atomica dei file di stato (.job-searcher/*.json), condivisi tra riga di comando e interfaccia web:
 * si scrive un file temporaneo e lo si rinomina. Il nome del temporaneo è unico per ogni scrittura (due richieste
 * dell'interfaccia nello stesso processo non devono usare lo stesso), e le scritture sullo stesso file si mettono
 * in fila: vince sempre l'ultima.
 */

const queues = new Map();

export function writeFileAtomic(file, data) {
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        await writeFile(tmp, data);
        await rename(tmp, file);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    });
  queues.set(file, next);
  // Finita la fila, la voce si toglie (niente memoria che cresce).
  next.finally(() => queues.get(file) === next && queues.delete(file)).catch(() => {});
  return next;
}
