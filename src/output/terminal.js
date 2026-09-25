const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const c = {
  bold: paint(1),
  dim: paint(2),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
  red: paint(31),
};

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('it-IT') : 's.d.';
}

export function renderTerminal(results, { limit = 50 } = {}) {
  const lines = [];
  for (const { target, jobs, stats } of results) {
    lines.push('', c.bold(c.cyan(`■ ${target.label} — ${jobs.length} offerte`)));
    for (const job of jobs.slice(0, limit)) {
      const badge = job.isNew ? c.green(' [NUOVA]') : '';
      lines.push(`${c.bold(job.title)}${badge}  ${c.dim(`punti ${job.score}`)}`);
      lines.push(`  ${[job.company, job.location, formatDate(job.postedAt), job.source].filter(Boolean).join(' · ')}`);
      lines.push(`  ${c.dim(job.url)}`);
    }
    if (jobs.length > limit) lines.push(c.dim(`  … altre ${jobs.length - limit} (usa --limit o il report HTML)`));
    lines.push(c.dim(`  fonti: ${formatStats(stats)}`));
  }
  return lines.join('\n');
}

export function formatStats(stats) {
  return Object.entries(stats)
    .map(([name, s]) => {
      if (s.error) return c.red(`${name} errore`);
      if (s.skipped) return c.yellow(`${name} saltata`);
      return `${name} ${s.kept}/${s.fetched}`;
    })
    .join(', ');
}
