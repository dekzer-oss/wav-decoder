import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

const THRESHOLD = 0.1;
const FILES = ['bench/bench-node.json', 'bench/bench-browser.json'];

/** collect fastest Hz per "suite – benchmark" key */
function flatten(json) {
  const map = new Map();

  if (!json || typeof json !== 'object' || !Array.isArray(json.files)) {
    throw new Error('Invalid benchmark data structure: expected object with "files" array');
  }

  json.files.forEach((f, fileIndex) => {
    if (!f || !Array.isArray(f.groups)) {
      console.warn(
        `⚠️  File ${fileIndex} has invalid structure: missing or invalid "groups" array`,
      );
      return;
    }

    f.groups.forEach((g, groupIndex) => {
      if (!g || typeof g.fullName !== 'string' || !Array.isArray(g.benchmarks)) {
        console.warn(`⚠️  Group ${groupIndex} in file ${fileIndex} has invalid structure`);
        return;
      }

      g.benchmarks.forEach((b, benchIndex) => {
        if (!b || typeof b.name !== 'string' || typeof b.hz !== 'number') {
          console.warn(
            `⚠️  Benchmark ${benchIndex} in group "${g.fullName}" has invalid structure`,
          );
          return;
        }

        const key = `${g.fullName} – ${b.name}`;
        if (!map.has(key) || b.hz > map.get(key)) {
          map.set(key, b.hz);
        }
      });
    });
  });

  return map;
}

async function loadCurrent() {
  const merged = new Map();
  const errors = [];

  for (const file of FILES) {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      const flattened = flatten(data);

      if (flattened.size === 0) {
        console.warn(`⚠️  No valid benchmarks found in ${file}`);
        continue;
      }

      flattened.forEach((hz, key) => {
        if (!merged.has(key) || hz > merged.get(key)) {
          merged.set(key, hz);
        }
      });

      console.log(`📊  Loaded ${flattened.size} benchmarks from ${file}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        errors.push(`File not found: ${file}`);
      } else if (error instanceof SyntaxError) {
        errors.push(`Invalid JSON in ${file}: ${error.message}`);
      } else if (error.message.includes('Invalid benchmark data structure')) {
        errors.push(`${file}: ${error.message}`);
      } else {
        errors.push(`Failed to read ${file}: ${error.message}`);
      }
    }
  }

  if (errors.length > 0) {
    console.warn(
      `⚠️  Issues loading current benchmark files:\n${errors.map((e) => `   • ${e}`).join('\n')}`,
    );
  }

  return merged;
}

function loadBaseline() {
  const merged = new Map();
  const errors = [];

  for (const file of FILES) {
    try {
      const raw = execSync(`git show origin/main:${file}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw);
      const flattened = flatten(data);

      if (flattened.size === 0) {
        console.warn(`⚠️  No valid benchmarks found in baseline ${file}`);
        continue;
      }

      flattened.forEach((hz, key) => {
        if (!merged.has(key) || hz > merged.get(key)) {
          merged.set(key, hz);
        }
      });

      console.log(`📊  Loaded ${flattened.size} baseline benchmarks from ${file}`);
    } catch (error) {
      if (error.status === 128) {
        // Git error - file doesn't exist or other git issue
        errors.push(`${file} not found on origin/main branch`);
      } else if (error.message.includes('SyntaxError') || error.stderr?.includes('JSON')) {
        errors.push(`Invalid JSON in baseline ${file}`);
      } else if (error.message.includes('Invalid benchmark data structure')) {
        errors.push(`Baseline ${file}: ${error.message}`);
      } else {
        errors.push(`Failed to load baseline ${file}: ${error.message}`);
      }
    }
  }

  if (errors.length > 0) {
    console.warn(
      `⚠️  Issues loading baseline benchmark files:\n${errors.map((e) => `   • ${e}`).join('\n')}`,
    );
  }

  return merged;
}

function checkGitRepository() {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkRemoteExists() {
  try {
    execSync('git remote get-url origin', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

(async () => {
  console.log('🔍  Starting benchmark performance comparison...\n');

  // Pre-flight checks
  if (!checkGitRepository()) {
    console.error('❌  Not in a git repository. Baseline comparison requires git.');
    process.exit(2);
  }

  if (!checkRemoteExists()) {
    console.error('❌  No "origin" remote found. Cannot fetch baseline from origin/main.');
    process.exit(2);
  }

  // Load current benchmarks
  console.log('📖  Loading current benchmark results...');
  const cur = await loadCurrent();

  if (cur.size === 0) {
    console.error('❌  No valid benchmark data found in current files.');
    console.error('   Expected files: ' + FILES.join(', '));
    console.error('   Make sure benchmark files exist and contain valid data.');
    process.exit(2);
  }

  console.log(`✅  Found ${cur.size} current benchmarks\n`);

  // Load baseline benchmarks
  console.log('📖  Loading baseline benchmark results from origin/main...');
  const base = loadBaseline();

  if (base.size === 0) {
    console.log('ℹ️   No baseline benchmarks found on origin/main branch.');
    console.log('   This might be the first benchmark run - skipping comparison.');
    process.exit(0);
  }

  console.log(`✅  Found ${base.size} baseline benchmarks\n`);

  // Compare benchmarks
  console.log('⚖️   Comparing performance...\n');

  let regressions = 0;
  let improvements = 0;
  let compared = 0;
  const skipped = [];

  for (const [key, curHz] of cur) {
    const oldHz = base.get(key);

    if (!oldHz) {
      skipped.push(key);
      continue;
    }

    compared++;
    const change = (oldHz - curHz) / oldHz;
    const changePercent = (change * 100).toFixed(1);

    if (change > THRESHOLD) {
      console.error(`❌  ${key}`);
      console.error(`    Performance regression: ${changePercent}% slower`);
      console.error(`    Before: ${oldHz.toFixed(0)} Hz → After: ${curHz.toFixed(0)} Hz\n`);
      regressions++;
    } else if (change < -0.05) {
      // Show improvements > 5%
      console.log(`🚀  ${key}: ${Math.abs(change * 100).toFixed(1)}% faster`);
      improvements++;
    }
  }

  // Summary
  console.log('📊  Summary:');
  console.log(`   • Compared: ${compared} benchmarks`);
  if (improvements > 0) {
    console.log(`   • Improvements: ${improvements}`);
  }
  if (regressions > 0) {
    console.log(`   • Regressions: ${regressions}`);
  }
  if (skipped.length > 0) {
    console.log(`   • Skipped (no baseline): ${skipped.length}`);
    if (skipped.length <= 5) {
      console.log(`     ${skipped.join(', ')}`);
    }
  }

  if (regressions > 0) {
    console.error(
      `\n❌  Found ${regressions} performance regression${regressions === 1 ? '' : 's'} > ${THRESHOLD * 100}%`,
    );
    process.exit(1);
  }

  console.log(`\n✅  No performance regressions detected (threshold: ${THRESHOLD * 100}%)`);
})();
