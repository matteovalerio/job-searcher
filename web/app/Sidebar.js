'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BoardIcon, BookIcon, BriefcaseIcon, CalendarIcon, ChartIcon, SearchIcon, UserIcon } from './icons.js';

/** Il profilo scelto resta in un cookie: così tutte le pagine sanno qual è quello attivo. */
function rememberProfile(cookieName, id) {
  // biome-ignore lint/suspicious/noDocumentCookie: basta un cookie semplice, letto dal server
  document.cookie = `${cookieName}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}

export default function Sidebar({ profiles, active, counts, cookieName }) {
  const pathname = usePathname();
  const router = useRouter();
  // Il profilo nell'indirizzo (?profile=…) si legge solo nel browser: così la barra fa parte dell'HTML iniziale
  // e non compare in ritardo (con useSearchParams Next la renderebbe solo lato client).
  const [fromUrl, setFromUrl] = useState(null);
  useEffect(() => {
    setFromUrl(pathname === '/' ? new URLSearchParams(window.location.search).get('profile') : null);
  }, [pathname]);
  const current = profiles.find((p) => p.id === (fromUrl ?? active)) ?? profiles[0];

  // Aprendo le offerte di un altro profilo (per esempio appena creato), diventa quello attivo.
  // Si aggiorna una volta sola per indirizzo, anche se il profilo non è ancora nell'elenco.
  const refreshed = useRef(null);
  useEffect(() => {
    if (fromUrl && fromUrl !== active && refreshed.current !== fromUrl) {
      refreshed.current = fromUrl;
      rememberProfile(cookieName, fromUrl);
      router.refresh();
    }
  }, [fromUrl, active, router, cookieName]);

  function change(id) {
    rememberProfile(cookieName, id);
    if (pathname === '/') {
      setFromUrl(id);
      router.push(`/?profile=${encodeURIComponent(id)}`);
    } else router.refresh();
  }

  const links = [
    { href: '/', label: 'Offerte', icon: BriefcaseIcon, count: counts.offers, match: (p) => p === '/' },
    {
      href: '/candidature',
      label: 'Candidature',
      icon: BoardIcon,
      count: counts.tracked,
      match: (p) => p.startsWith('/candidature'),
    },
    {
      href: '/case-editrici',
      label: 'Case editrici e affini',
      icon: BookIcon,
      count: counts.publishers,
      match: (p) => p.startsWith('/case-editrici'),
    },
    { href: '/piano', label: 'Piano', icon: CalendarIcon, count: counts.due, match: (p) => p.startsWith('/piano') },
    { href: '/mercato', label: 'Mercato', icon: ChartIcon, match: (p) => p.startsWith('/mercato') },
    { href: '/profili', label: 'Profili', icon: UserIcon, match: (p) => p.startsWith('/profili') },
  ];

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <SearchIcon width={2.2} />
        </span>
        job-searcher
      </Link>
      <nav className="nav" aria-label="Sezioni">
        {links.map(({ href, label, icon: NavIcon, count, match }) => (
          <Link key={href} href={href} aria-current={match(pathname) ? 'page' : undefined}>
            <NavIcon size={18} />
            <span className="label">{label}</span>
            {count > 0 && <span className="count">{count}</span>}
          </Link>
        ))}
      </nav>
      {current && (
        <div className="active-profile">
          <div className="overline">Profilo attivo</div>
          <div className="name">{current.name ?? current.id}</div>
          <label className="sr-only" htmlFor="active-profile">
            Cambia profilo
          </label>
          <select id="active-profile" value={current.id} onChange={(e) => change(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </select>
        </div>
      )}
    </aside>
  );
}
