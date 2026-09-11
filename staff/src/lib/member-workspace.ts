export type MemberWorkspaceSurface = 'record' | 'session';

export type MemberWorkspaceSection =
  | 'session-brief'
  | 'current-visit'
  | 'intake-context'
  | 'practice-work'
  | 'session-note'
  | 'record-overview'
  | 'workflows'
  | 'money'
  | 'session-history'
  | 'appointments'
  | 'notes';

export const MEMBER_WORKSPACE_SECTIONS: Readonly<Record<MemberWorkspaceSurface, readonly MemberWorkspaceSection[]>> = {
  session: ['session-brief', 'current-visit', 'intake-context', 'practice-work', 'session-note'],
  record: ['record-overview', 'workflows', 'money', 'session-history', 'appointments', 'notes'],
};

export function sectionSurface(section: MemberWorkspaceSection): MemberWorkspaceSurface {
  return MEMBER_WORKSPACE_SECTIONS.session.includes(section) ? 'session' : 'record';
}

export function memberWorkspacePath(
  contactId: string,
  surface: MemberWorkspaceSurface,
  appointmentId?: string | null,
): string {
  const root = `/client/${encodeURIComponent(contactId)}`;
  const path = surface === 'session' ? `${root}/session` : `${root}/record`;
  return appointmentId ? `${path}?appointment=${encodeURIComponent(appointmentId)}` : path;
}

export function clientDeskContactPath(contactId: string, intent?: 'note'): string {
  return `/client-desk?contact=${encodeURIComponent(contactId)}${intent === 'note' ? '&intent=note' : ''}`;
}

/** Forward only the supported contact handoff, never arbitrary Staff query data. */
export function applyClientDeskHandoff(deskUrl: URL, contact: string | null, intent: string | null): void {
  deskUrl.searchParams.delete('contact');
  deskUrl.searchParams.delete('intent');
  if (!contact || !/^[A-Za-z0-9_-]{1,80}$/.test(contact)) return;
  deskUrl.searchParams.set('contact', contact);
  if (intent === 'note') deskUrl.searchParams.set('intent', 'note');
}
