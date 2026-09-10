import { describe, expect, it } from 'vitest';
import {
  MEMBER_WORKSPACE_SECTIONS,
  clientDeskContactPath,
  applyClientDeskHandoff,
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

  it('hands exact-contact note work to the owned Client Desk', () => {
    expect(clientDeskContactPath('person/123')).toBe('/client-desk?contact=person%2F123');
  });
});

describe('Client Desk note handoff', () => {
  it('encodes exact identity without query injection and opts into notes explicitly', () => {
    expect(clientDeskContactPath('person/123 &intent=sms', 'note')).toBe('/client-desk?contact=person%2F123%20%26intent%3Dsms&intent=note');
    expect(clientDeskContactPath('owned_123', 'note')).toBe('/client-desk?contact=owned_123&intent=note');
  });
  it.each([null, 'sms', 'NOTE', 'note&send=true'])('preserves ordinary contact navigation for intent %s', (intent) => {
    const url = new URL('https://desk.example/client-desk?embed=1#dashboard_session=signed');
    applyClientDeskHandoff(url, 'owned_123-ab', intent);
    expect(url.searchParams.get('contact')).toBe('owned_123-ab');
    expect(url.searchParams.has('intent')).toBe(false);
    expect(url.hash).toBe('#dashboard_session=signed');
  });
  it('forwards only validated note intent and contact', () => {
    const url = new URL('https://desk.example/client-desk?embed=1');
    applyClientDeskHandoff(url, 'owned_123-ab', 'note');
    expect(url.search).toBe('?embed=1&contact=owned_123-ab&intent=note');
  });
  it.each([null, '', 'a&send=true', 'person/123', 'a'.repeat(81)])('drops invalid contact and its note intent: %s', (contact) => {
    const url = new URL('https://desk.example/client-desk?contact=stale&intent=note');
    applyClientDeskHandoff(url, contact, 'note');
    expect(url.search).toBe('');
  });
});
