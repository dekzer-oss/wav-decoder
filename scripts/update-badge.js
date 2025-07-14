import fs from 'node:fs/promises';

const files = ['bench/bench-browser.json', 'bench/bench-node.json']; // browser first
const all = [];

for (const p of files) {
  try {
    const data = JSON.parse(await fs.readFile(p, 'utf8'));
    all.push(...data.files.flatMap((f) => f.groups.flatMap((g) => g.benchmarks)));
  } catch {
    /* ignore missing */
  }
}

if (!all.length) {
  console.error('no benchmarks to badge');
  process.exit(1);
}

const best =
  all
    .filter(
      (b) =>
        b.name.includes('browser') ||
        b.name.includes('chromium') ||
        b.name.includes('firefox') ||
        b.name.includes('webkit')
    )
    .sort((a, b) => b.hz - a.hz)[0] ?? all.sort((a, b) => b.hz - a.hz)[0];

const badge = {
  schemaVersion: 1,
  label: 'decode speed',
  message: `${Math.round(best.hz).toLocaleString()} Hz`,
  color: 'brightgreen',
};

await fs.writeFile('bench/badge.json', JSON.stringify(badge, null, 2));
