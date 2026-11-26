import { describe, expect, it } from 'vitest';
import { toAria2Limit, formatBytes, formatEta } from '../src/shared/limits';
import { assertTransition, canTransition, IllegalTransitionError, TRANSITIONS } from '../src/shared/jobState';
import { mapAria2Error } from '../src/shared/errors';
import type { JobStatus } from '../src/shared/types';

describe('toAria2Limit', () => {
  it('never sends 0 for a real cap (aria2 treats 0 as unlimited)', () => {
    expect(toAria2Limit(-1)).toBe('0');
    expect(toAria2Limit(1)).toBe('1K');
    expect(toAria2Limit(0.2)).toBe('1K');
    expect(toAria2Limit(50)).toBe('50K');
    expect(toAria2Limit(1000)).toBe('1M');
    expect(toAria2Limit(25_000)).toBe('25M');
  });
});

describe('job state machine', () => {
  const all = Object.keys(TRANSITIONS) as JobStatus[];

  it('sends paused and failed jobs back through queued', () => {
    expect(canTransition('paused', 'active')).toBe(false);
    expect(canTransition('error', 'active')).toBe(false);
    expect(canTransition('paused', 'queued')).toBe(true);
    expect(canTransition('error', 'queued')).toBe(true);
  });

  it('throws on every illegal transition', () => {
    for (const from of all) {
      for (const to of all) {
        if (from === to || TRANSITIONS[from].includes(to)) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
      }
    }
  });

  it('treats cancelled as terminal', () => {
    expect(TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('mapAria2Error', () => {
  it('maps aria2 exit codes', () => {
    expect(mapAria2Error('3')).toBe('HTTP_ERROR');
    expect(mapAria2Error(22)).toBe('HTTP_ERROR');
    expect(mapAria2Error(24)).toBe('AUTH_REQUIRED');
    expect(mapAria2Error(9)).toBe('DISK_ERROR');
    expect(mapAria2Error(16)).toBe('DISK_ERROR');
    expect(mapAria2Error(2)).toBe('NETWORK');
    expect(mapAria2Error(6)).toBe('NETWORK');
    expect(mapAria2Error(8)).toBe('NO_RESUME');
    expect(mapAria2Error(32)).toBe('CHECKSUM_FAILED');
    expect(mapAria2Error(undefined)).toBe('UNKNOWN');
  });
});

describe('formatting', () => {
  it('formats sizes and ETAs', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(6.1 * 1024 ** 3)).toBe('6.1 GB');
    expect(formatEta(30)).toBe('30 s left');
    expect(formatEta(300)).toBe('5 min left');
    expect(formatEta(null)).toBe('');
  });
});
