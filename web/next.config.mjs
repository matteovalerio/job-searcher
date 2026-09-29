import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('next').NextConfig} */
export default {
  // Il programma sta nella cartella superiore e viene caricato a runtime (vedi lib/core.js).
  turbopack: { root },
  outputFileTracingRoot: root,
};
