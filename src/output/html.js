const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('it-IT') : 's.d.');

function renderStats(stats) {
  return Object.entries(stats)
    .map(([name, s]) => {
      if (s.error) return `<span class="err" title="${esc(s.error)}">${esc(name)}: errore</span>`;
      if (s.skipped) return `<span class="skip" title="${esc(s.skipped)}">${esc(name)}: saltata</span>`;
      return `<span>${esc(name)}: ${s.kept}/${s.fetched}</span>`;
    })
    .join(' ');
}

function renderJob(job) {
  const also = job.alsoOn?.length
    ? ` · anche su ${job.alsoOn.map((o) => `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.source)}</a>`).join(', ')}`
    : '';
  return `<article class="job${job.isNew ? ' new' : ''}">
  <h3><a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.title)}</a>${job.isNew ? ' <span class="badge">nuova</span>' : ''}</h3>
  <p class="meta">${[job.company, job.location, date(job.postedAt), job.salary].filter(Boolean).map(esc).join(' · ')}</p>
  <p class="meta">${esc(job.source)}${also} · punti ${job.score} · parole: ${esc([...job.matched, ...job.boosted].join(', '))}</p>
  ${job.description ? `<details><summary>Descrizione</summary><p>${esc(job.description)}</p></details>` : ''}
</article>`;
}

export function renderHtml(results, { title = 'Offerte di lavoro', generatedAt = new Date() } = {}) {
  const sections = results
    .map(
      ({ target, jobs, stats }) => `<section>
  <h2>${esc(target.label)} <small>${jobs.length} offerte</small></h2>
  <p class="stats">Fonti (tenute/scaricate): ${renderStats(stats)}</p>
  ${jobs.map(renderJob).join('\n')}
</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg:#fafaf8; --fg:#1d1d1b; --muted:#6b6b66; --line:#e3e2dc; --accent:#1f5fbf; --new:#1a7f37; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --fg:#ecebe6; --muted:#9a9990; --line:#2e2d2a; --accent:#7eb0ff; --new:#5fd17a; } }
  body { background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; max-width:900px; margin:0 auto; padding:16px; }
  h1 { font-size:1.5rem; margin-bottom:0; } h2 { margin-top:2rem; border-bottom:1px solid var(--line); padding-bottom:4px; }
  h2 small, .meta, .stats, header p { color:var(--muted); font-weight:normal; font-size:.9em; }
  h3 { margin:0; font-size:1.05rem; } a { color:var(--accent); }
  .job { padding:10px 0; border-bottom:1px solid var(--line); } .meta { margin:2px 0; }
  .badge { background:var(--new); color:var(--bg); border-radius:4px; font-size:.75em; padding:1px 6px; vertical-align:middle; }
  .err { color:#c0392b; } .skip { color:#b7791f; }
  input { width:100%; box-sizing:border-box; padding:8px; font:inherit; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:6px; }
  label { color:var(--muted); font-size:.9em; }
  details p { white-space:pre-line; font-size:.9em; }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <p>Generato il ${generatedAt.toLocaleString('it-IT')}</p>
  <input id="q" type="search" placeholder="Filtra per testo (titolo, azienda, luogo…)">
  <label><input id="onlyNew" type="checkbox" style="width:auto"> solo nuove</label>
</header>
${sections}
<script>
  const q = document.getElementById('q'), onlyNew = document.getElementById('onlyNew');
  function apply() {
    const term = q.value.toLowerCase();
    for (const el of document.querySelectorAll('.job')) {
      const ok = el.textContent.toLowerCase().includes(term) && (!onlyNew.checked || el.classList.contains('new'));
      el.hidden = !ok;
    }
  }
  q.addEventListener('input', apply); onlyNew.addEventListener('change', apply);
</script>
</body>
</html>
`;
}
