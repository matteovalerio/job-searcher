import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'job-searcher',
  description: 'Offerte di lavoro da più portali, filtrate per il tuo profilo',
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            job-searcher
          </Link>
          <nav>
            <Link href="/">Offerte</Link>
            <Link href="/candidature">Candidature</Link>
            <Link href="/profili">Profili</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
