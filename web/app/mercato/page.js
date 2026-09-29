import Link from 'next/link';
import { marketForActiveProfile } from '../../lib/market.js';
import MarketView from './MarketView.js';

export const dynamic = 'force-dynamic';

export default async function Mercato() {
  const market = await marketForActiveProfile();
  if (!market) {
    return (
      <div className="page">
        <h1>Analisi del mercato</h1>
        <div className="empty">
          Nessun profilo ancora. <Link href="/profili/nuovo">Crea un profilo</Link> e lancia una ricerca.
        </div>
      </div>
    );
  }
  return <MarketView name={market.name} analysis={market.analysis} found={market.found} />;
}
