import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('handles quotes, commas and empty fields', () => {
    const rows = parseCsv('a,b,c\r\n1,"x, ""y""",\n2,,"z"\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, "y"', c: '' },
      { a: '2', b: '', c: 'z' },
    ]);
  });
});
