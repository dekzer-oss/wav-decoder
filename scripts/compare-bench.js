import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

const THRESHOLD = 0.1;
const FILES = ['bench/bench-node.json', 'bench/bench-browser.json'];

const flatten = (d) =>
  d.files.flatMap((f) =>
    f.groups.flatMap((g) => g.benchmarks.map((b) => ({ key: `${g.fullName} – ${b.name}`, hz: b.hz })))
  );

const current = [];
for (const p of FILES) {
  try {
    current.push(...flatten(JSON.parse(await fs.readFile(p, 'utf8'))));
  } catch {
    /* file missing – skip */
  }
}

if (!current.length) {
  console.error('no benchmark data to compare');
  process.exit(2);
}

let baseline = [];
try {
  for (const p of FILES) {
    const raw = execSync(`git show origin/main:${p}`, { encoding: 'utf8' });
    baseline.push(...flatten(JSON.parse(raw)));
  }
} catch {
  console.log('no baseline on main – first run, skipping diff');
  process.exit(0);
}

const baseMap = new Map(baseline.map((b) => [b.key, b.hz]));
let failed = false;

for (const cur of current) {
  const old = baseMap.get(cur.key);
  if (!old) continue;
  if ((old - cur.hz) / old > THRESHOLD) {
    console.error(`❌  ${cur.key} regressed ${(((old - cur.hz) / old) * 100).toFixed(1)} %`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('✅  no perf regressions > 10 %');
