// import { WavDecoder } from '../src';
// import { it, expect } from 'vitest';
// import { evilFixtureExpectations } from './fixtures/generate-evil';
//
// it.each(Object.entries(evilFixtureExpectations))('should catch issue: %s', (filename, { desc, expect: _expect }) => {
//   const wav = loadedEvilFixtures.get(filename);
//   const decoder = new WavDecoder();
//   const result = decoder.decode(wav!);
//   const allErrors = [...result.errors, ...(decoder.info.format.warnings || [])]
//     .map((e) => (typeof e === 'string' ? e : e.message))
//     .join(' ');
//   expect(allErrors).toContain(_expect);
// });
