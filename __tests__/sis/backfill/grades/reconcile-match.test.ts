import { describe, it, expect } from 'vitest';
import { buildNameToEnrolee } from '@/lib/sis/backfill/grades/reconcile-match';

const CSV = [
  'Band,Index,Level,Class (section),Student Name (sheet),Sheet Status,Target Status,Match Method,Confidence,# Apps,Dup Flag,Enrolee No(s),Student No(s),Canonical Enrolee',
  'Primary,1,Primary One,Patience - Global,"ASPIRAS, David Ray M.",Active,Enrolled,structured,high,1,NONE,E250689,H250689,E250689',
  'Primary,2,Primary One,Patience - Global,"DOMINGO, Gio Lucas P.",Active,Enrolled,structured,high,1,DIFF_SN,E250695,H250695,E250695',
].join('\n');

describe('buildNameToEnrolee', () => {
  it('maps the sheet name to the canonical enrolee + dup flag', () => {
    const m = buildNameToEnrolee(CSV);
    expect(m.get('ASPIRAS, David Ray M.')).toEqual({
      enrolee: 'E250689',
      dup: 'NONE',
    });
    expect(m.get('DOMINGO, Gio Lucas P.')).toEqual({
      enrolee: 'E250695',
      dup: 'DIFF_SN',
    });
  });
});
