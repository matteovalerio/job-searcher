import path from 'node:path';

/*
 * Dove il programma tiene i suoi file. Di default è la cartella da cui lo si lancia; JOB_SEARCHER_HOME
 * permette di usarlo da altrove (per esempio dall'interfaccia web, che gira nella sottocartella web/).
 */
export const homeDir = () => path.resolve(process.env.JOB_SEARCHER_HOME || process.cwd());

/** Stato interno: offerte già viste, candidature, ultimi risultati, profilo del browser. */
export const stateDir = (...parts) => path.join(homeDir(), '.job-searcher', ...parts);

export const reportsDir = () => path.join(homeDir(), 'reports');

export const envFile = () => path.join(homeDir(), '.env');
