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
  const path = surface === 'session' ? `${root}/session` : root;
  return appointmentId ? `${path}?appointment=${encodeURIComponent(appointmentId)}` : path;
}
