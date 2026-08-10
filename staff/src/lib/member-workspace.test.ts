import { describe, expect, it } from 'vitest';
import {
  MEMBER_WORKSPACE_SECTIONS,
  memberWorkspacePath,
  sectionSurface,
} from './member-workspace';

describe('member workspace structure', () => {
  it('keeps live-session work separate from the long-term member record', () => {
    expect(MEMBER_WORKSPACE_SECTIONS.session).toEqual([
      'session-brief',
      'current-visit',
      'intake-context',
      'practice-work',
      'session-note',
    ]);
    expect(MEMBER_WORKSPACE_SECTIONS.record).toEqual([
      'record-overview',
      'workflows',
      'money',
      'session-history',
      'appointments',
      'notes',
    ]);
    expect(sectionSurface('practice-work')).toBe('session');
    expect(sectionSurface('workflows')).toBe('record');
  });

  it('assigns every section exactly once', () => {
    const all = [...MEMBER_WORKSPACE_SECTIONS.session, ...MEMBER_WORKSPACE_SECTIONS.record];
    expect(new Set(all).size).toBe(all.length);
  });

  it('builds stable record and session routes while preserving appointment context', () => {
    expect(memberWorkspacePath('person/123', 'record')).toBe('/client/person%2F123/record');
    expect(memberWorkspacePath('person/123', 'session')).toBe('/client/person%2F123/session');
    expect(memberWorkspacePath('person/123', 'record', 'appt 1')).toBe('/client/person%2F123/record?appointment=appt%201');
    expect(memberWorkspacePath('person/123', 'session', 'appt 1')).toBe('/client/person%2F123/session?appointment=appt%201');
  });
});
