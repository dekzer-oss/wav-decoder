import fs from 'node:fs/promises';
import path from 'node:path';

const files = ['bench/bench-browser.json', 'bench/bench-node.json'];

for (const filePath of files) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    console.error(`⚠️  File not found or invalid JSON: ${filePath}`);
    continue;
  }

  // Flatten all benchmarks, carrying along file.size if available
  const benches = data.files.flatMap((file) =>
    file.groups.flatMap((group) => group.benchmarks.map((b) => ({ ...b, fileSize: file.size })))
  );

  if (!benches.length) {
    console.error(`⚠️  No benchmarks in ${filePath}`);
    continue;
  }

  // Pick the fastest
  const best = benches.reduce((a, b) => (b.hz > a.hz ? b : a));

  // Determine fileSizeBytes (in bytes)
  // If your bench JSON doesn't include file.size, adjust this fallback:
  const fileSizeBytes = best.fileSize ?? 44100 * 2; // e.g. 44.1 k samples × 2 bytes/sample

  // Compute MiB/s
  const mibPerSec = (best.hz * fileSizeBytes) / 2 ** 20;

  // Derive mode for labeling
  const mode = path.basename(filePath).includes('browser') ? 'browser' : 'node';

  const badge = {
    schemaVersion: 1,
    label: `decode speed (${mode})`,
    message: `${mibPerSec.toFixed(1)} MiB/s`,
    color: 'brightgreen',
  };

  const outPath = `bench/badge-${mode}.json`;
  await fs.writeFile(outPath, JSON.stringify(badge, null, 2));
  console.log(`✅  Wrote ${outPath}`);
}
