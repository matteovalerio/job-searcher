import './globals.css';
import { Suspense } from 'react';
import { activeProfileId, PROFILE_COOKIE } from '../lib/active-profile.js';
import { core, resultsForPage } from '../lib/core.js';
import Sidebar from './Sidebar.js';

export const metadata = {
  title: 'job-searcher',
  description: 'Offerte di lavoro da più portali, filtrate per il tuo profilo',
};

/** Numeri della barra laterale: offerte dell'ultima ricerca del profilo attivo e candidature seguite. */
async function sidebarData() {
  const { listProfiles, Tracking } = await core();
  const profiles = await listProfiles();
  const active = await activeProfileId(profiles);
  const [results, tracking] = await Promise.all([active ? resultsForPage(active) : null, new Tracking().load()]);
  const offers = new Set(results?.targets.flatMap((t) => t.jobs.map((j) => j.id)) ?? []).size;
  return {
    profiles: profiles.map(({ id, name }) => ({ id, name })),
    active,
    counts: { offers, tracked: tracking.list().length },
  };
}

export default async function RootLayout({ children }) {
  const data = await sidebarData();
  return (
    <html lang="it">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif&display=swap"
        />
      </head>
      <body>
        <div className="shell">
          <Suspense>
            <Sidebar {...data} cookieName={PROFILE_COOKIE} />
          </Suspense>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
