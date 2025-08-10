import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

const THRESHOLD = 0.1;
const FILES = ['bench/bench-browser-chrome.json'];

/** collect fastest Hz per “suite – benchmark” key */
function flatten(json) {
  const map = new Map();
  json.files.forEach((f) =>
    f.groups.forEach((g) =>
      g.benchmarks.forEach((b) => {
        const key = `${g.fullName} – ${b.name}`;
        if (!map.has(key) || b.hz > map.get(key)) map.set(key, b.hz);
      })
    )
  );
  return map;
}

async function loadCurrent() {
  const merged = new Map();
  for (const file of FILES) {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      flatten(data).forEach((hz, key) => {
        if (!merged.has(key) || hz > merged.get(key)) merged.set(key, hz);
      });
    } catch {
      /* file missing, skip */
    }
  }
  return merged;
}

function loadBaseline() {
  const merged = new Map();
  for (const file of FILES) {
    try {
      const raw = execSync(`git show origin/main:${file}`, { encoding: 'utf8' });
      flatten(JSON.parse(raw)).forEach((hz, key) => {
        if (!merged.has(key) || hz > merged.get(key)) merged.set(key, hz);
      });
    } catch {
      /* file absent on main, ignore */
    }
  }
  return merged;
}

(async () => {
  const cur = await loadCurrent();
  if (cur.size === 0) {
    console.error('no benchmark data to compare');
    process.exit(2);
  }

  const base = loadBaseline();
  if (base.size === 0) {
    console.log('no baseline on main – first run, skipping diff');
    process.exit(0);
  }

  let failed = false;
  for (const [key, curHz] of cur) {
    const oldHz = base.get(key);
    if (!oldHz) continue;
    if ((oldHz - curHz) / oldHz > THRESHOLD) {
      console.error(`❌  ${key} regressed ${(((oldHz - curHz) / oldHz) * 100).toFixed(1)} %`);
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('✅  no perf regressions > 10 %');
})();
