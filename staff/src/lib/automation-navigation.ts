export function automationDrilldownPath(familyKey: string, contactId: string): string {
  const params = new URLSearchParams({ family: familyKey, contact: contactId });
  return `/automations?${params.toString()}`;
}
