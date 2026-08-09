export function automationDrilldownPath(familyKey: string, contactId: string): string {
  const params = new URLSearchParams({ contact: contactId });
  return `/automations/${encodeURIComponent(familyKey)}?${params.toString()}`;
}
