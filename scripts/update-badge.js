import fs from 'node:fs/promises';
import path from 'node:path';
import glob from 'fast-glob';

const PERFORMANCE_THRESHOLDS = {
  EXCELLENT: 400,
  GOOD: 300,
  AVERAGE: 200,
  POOR: 100,
};

async function readJsonFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    console.error(`⚠️  File not found or invalid JSON: ${filePath}`);
    return null;
  }
}

function flattenBenchmarks(data) {
  return data.files.flatMap((file) =>
    file.groups.flatMap((group) =>
      group.benchmarks.map((benchmark) => ({
        ...benchmark,
        fileSize: file.size,
      }))
    )
  );
}

function findBestBenchmark(benchmarks) {
  return benchmarks.reduce((best, current) => (current.hz > best.hz ? current : best));
}

function calculateThroughput(hz, fileSizeBytes) {
  return (hz * fileSizeBytes) / 2 ** 20;
}

function getBadgeColor(throughput) {
  if (throughput >= PERFORMANCE_THRESHOLDS.EXCELLENT) {
    return 'brightgreen';
  } else if (throughput >= PERFORMANCE_THRESHOLDS.GOOD) {
    return 'orange';
  } else if (throughput >= PERFORMANCE_THRESHOLDS.AVERAGE) {
    return 'yellow';
  } else {
    return 'red';
  }
}

// NEW: extract browser name from filename, e.g. "bench/bench-browser-chrome.json"
function extractBrowser(filePath) {
  const m = path.basename(filePath).match(/bench-browser-([^.]+)\.json$/);
  return m ? m[1] : null;
}

function createBadge(label, throughput) {
  return {
    schemaVersion: 1,
    label: `throughput (${label})`,
    message: `${throughput.toFixed(1)} MiB/s`,
    color: getBadgeColor(throughput),
  };
}

async function writeBadgeFile(label, badge) {
  const outPath = `bench/badge-browser-${label}.json`;
  await fs.writeFile(outPath, JSON.stringify(badge, null, 2));
  console.log(`✅  Wrote ${outPath}`);
}

async function processBenchmarkFile(filePath) {
  const data = await readJsonFile(filePath);
  if (!data) return;

  const benchmarks = flattenBenchmarks(data);
  if (!benchmarks.length) {
    console.error(`⚠️  No benchmarks in ${filePath}`);
    return;
  }

  const best = findBestBenchmark(benchmarks);
  const fileSizeBytes = best.fileSize ?? 44100 * 2;
  const throughput = calculateThroughput(best.hz, fileSizeBytes);
  const browser = extractBrowser(filePath);
  if (!browser) {
    console.warn(`⚠️  Could not extract browser name from: ${filePath}`);
    return;
  }

  const badge = createBadge(browser, throughput);
  await writeBadgeFile(browser, badge);
}

async function main() {
  const files = await glob('bench/bench-browser-*.json');
  if (!files.length) {
    console.error('No browser bench JSON files found.');
    return;
  }

  for (const filePath of files) {
    await processBenchmarkFile(filePath);
  }
}

main().catch(console.error);
