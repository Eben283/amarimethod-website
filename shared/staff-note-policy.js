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
  /^test manual-enrollment(?: appointment)?\b/i,
];

export function plainTextNoteBody(body) {
  const text = typeof body === 'string' ? body : '';
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSystemNote(body) {
  const text = plainTextNoteBody(body);
  return SYSTEM_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasNoteSignature(body) {
  return /<img[^>]*\bsrc=["']data:image\//i.test(typeof body === 'string' ? body : '');
}

export function isEditableStaffNote(body) {
  return !isSystemNote(body) && !hasNoteSignature(body);
}
