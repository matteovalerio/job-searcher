/*
 * Offerte dai dati strutturati schema.org (JSON-LD) che molti siti inseriscono nelle pagine:
 * è il modo più affidabile di leggerle, perché non dipende dall'aspetto della pagina.
 */

const text = (v) => (typeof v === 'string' ? v : (v?.name ?? v?.label ?? v?.value ?? ''));

function fromJsonLd(posting, baseUrl) {
  const address = [posting.jobLocation].flat()[0]?.address ?? {};
  return {
    id: posting.identifier?.value ?? posting.url,
    title: posting.title,
    company: text(posting.hiringOrganization),
    location: [address.addressLocality, address.addressRegion].filter(Boolean).join(', '),
    url: posting.url ? new URL(posting.url, baseUrl).href : '',
    postedAt: posting.datePosted,
    description: posting.description,
    remote: posting.jobLocationType === 'TELECOMMUTE' ? true : null,
  };
}

/** Offerte dai blocchi JSON-LD (schema.org JobPosting, anche dentro una ItemList). */
export function parseJsonLd($, baseUrl) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if ([node['@type']].flat().includes('JobPosting')) out.push(fromJsonLd(node, baseUrl));
    visit(node['@graph']);
    visit(node.itemListElement);
    visit(node.item);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // blocco non valido: si ignora
    }
  });
  return out;
}
