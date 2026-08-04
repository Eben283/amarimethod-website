const SYSTEM_NOTE_PATTERNS = [
  /^migrat/i,
  /^\[?reconciliation/i,
  /^outcome:/i,
  /^touch:/i,
  /^skip:/i,
  /^enrichment/i,
  /^audit/i,
  /^correction/i,
  /^ip:/i,
  /^user.?agent:/i,
  /captured at:/i,
  /^next: customer redirected/i,
];

export function isSystemNote(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  return SYSTEM_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasNoteSignature(body) {
  return /<img[^>]*\bsrc=["']data:image\//i.test(typeof body === 'string' ? body : '');
}

export function isEditableStaffNote(body) {
  return !isSystemNote(body) && !hasNoteSignature(body);
}
