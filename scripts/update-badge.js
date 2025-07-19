import fs from 'node:fs/promises';
import path from 'node:path';

// Performance thresholds for WAV decoders (MiB/s)
const PERFORMANCE_THRESHOLDS = {
  EXCELLENT: 400,
  GOOD: 300,
  AVERAGE: 200,
  POOR: 100,
};

/**
 * Reads and parses JSON file safely
 */
async function readJsonFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    console.error(`⚠️  File not found or invalid JSON: ${filePath}`);
    return null;
  }
}

/**
 * Flattens benchmark data from nested structure
 */
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

/**
 * Finds the benchmark with highest Hz (performance)
 */
function findBestBenchmark(benchmarks) {
  return benchmarks.reduce((best, current) => (current.hz > best.hz ? current : best));
}

/**
 * Calculates throughput in MiB/s
 */
function calculateThroughput(hz, fileSizeBytes) {
  return (hz * fileSizeBytes) / 2 ** 20;
}

/**
 * Determines badge color based on performance
 */
function getBadgeColor(throughput) {
  if (throughput >= PERFORMANCE_THRESHOLDS.EXCELLENT) {
    return 'brightgreen';
  } else if (throughput >= PERFORMANCE_THRESHOLDS.AVERAGE) {
    return 'yellow';
  } else if (throughput >= PERFORMANCE_THRESHOLDS.GOOD) {
    return 'orange';
  } else {
    return 'red';
  }
}

/**
 * Extracts mode from file path
 */
function extractMode(filePath) {
  return path.basename(filePath).includes('browser') ? 'browser' : 'node';
}

/**
 * Creates badge object with performance data
 */
function createBadge(mode, throughput) {
  return {
    schemaVersion: 1,
    label: `throughput (${mode})`,
    message: `${throughput.toFixed(1)} MiB/s`,
    color: getBadgeColor(throughput),
  };
}

/**
 * Writes badge JSON to file
 */
async function writeBadgeFile(mode, badge) {
  const outPath = `bench/badge-${mode}.json`;
  await fs.writeFile(outPath, JSON.stringify(badge, null, 2));
  console.log(`✅  Wrote ${outPath}`);
}

/**
 * Processes a single benchmark file
 */
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
  const mode = extractMode(filePath);

  const badge = createBadge(mode, throughput);
  await writeBadgeFile(mode, badge);
}

/**
 * Main function to process all benchmark files
 */
async function main() {
  const files = ['bench/bench-browser.json', 'bench/bench-node.json'];

  for (const filePath of files) {
    await processBenchmarkFile(filePath);
  }
}

main().catch(console.error);
