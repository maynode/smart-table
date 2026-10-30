import { describe, expect, it } from 'vitest';
import { buildSrcDoc, demoRatingBundle } from './bridge-protocol';

describe('ai-component bridge-protocol', () => {
  it('builds srcdoc with bridge and user bundle', () => {
    const bundle = demoRatingBundle();
    const doc = buildSrcDoc(bundle);
    expect(doc).toContain('window.smartTable');
    expect(doc).toContain('id="root"');
    expect(doc).toContain('setCell');
    expect(doc).toContain('getCell().then');
    expect(doc).toContain("smartTable:cell");
  });
});
