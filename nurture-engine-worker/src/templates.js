// Executable, fail-closed nurture template catalog.
//
// Only the current published Flow 3 copy is admitted here. Flow 1 and Flow 2 remain schedule-
// only shadow definitions until their complete catalogs are reviewed and added. This module
// renders content but does not address a recipient or send anything.

const MERGE_RE = /{{\s*([a-z0-9_.]+)\s*}}/gi;

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

export const FLOW_3_POST_INITIAL_TEMPLATES = deepFreeze({
  "f3-email-1-protocols-portal": {
    sequenceId: "flow-3-post-initial",
    audience: "client",
    channel: "email",
    from: { name: "Garrett", email: "garrett@amarimethod.com" },
    subject: "Your protocols are in the portal, {{contact.first_name}}",
    preheader: "Do the protocols. Don't force them.",
    body: "Hi {{contact.first_name}},\n\nLoved working with you today!\n\nOver the next day or two you'll probably feel some shifts. Things loosening up, maybe a little soreness in spots that haven't been sore in a while. That's your body recalibrating. It's a good sign.\n\nHere's everything you need.\n\nYour protocols:\nAccess your tools → https://www.amarimethod.com/tools\n\nBook sessions and track your progress:\nYour client portal → https://www.amarimethod.com/portal/\n\nThe main thing this week: do the protocols, but don't force them. They should feel like relief, not work. If something feels like effort, ease back. The movement should feel like your body remembering something, not learning something new.\n\nReply here if anything comes up. I read these myself.\n\nGarrett",
  },
  "f3-email-2-practice-going": {
    sequenceId: "flow-3-post-initial",
    audience: "client",
    channel: "email",
    from: { name: "Garrett", email: "garrett@amarimethod.com" },
    subject: "How's the practice going, {{contact.first_name}}?",
    preheader: "Most people notice something by now.",
    body: "Hi {{contact.first_name}},\n\nIt's been a few days. Just wondering how you're doing.\n\nBy now you've probably noticed one of two things. Either something has clearly shifted, like less tension or better sleep. Or things feel like they're slowly reorganizing. Both are normal. Both mean it's working.\n\nThe protocols are doing the real work between sessions. Every time you do them, you're reinforcing what we started. That's how this becomes lasting. Your body starts to own it, so you don't need me for it.\n\nIf anything feels off, or you have questions about the protocols, just reply here.\n\nWhen you're ready to keep going:\nBook your next session → https://www.amarimethod.com/portal/\n\nGarrett",
  },
});

export const NURTURE_TEMPLATES = FLOW_3_POST_INITIAL_TEMPLATES;

function renderText(text, fields) {
  return text.replace(MERGE_RE, (_, key) => {
    const value = fields[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`missing required nurture merge field: ${key}`);
    }
    return value.trim();
  });
}

export function getNurtureTemplate(templateId) {
  return NURTURE_TEMPLATES[templateId] || null;
}

export function renderNurtureTemplate(templateId, fields = {}) {
  const template = getNurtureTemplate(templateId);
  if (!template) throw new Error(`unowned nurture template: ${templateId}`);
  const rendered = {
    templateId,
    sequenceId: template.sequenceId,
    audience: template.audience,
    channel: template.channel,
    from: { ...template.from },
    subject: renderText(template.subject, fields),
    preheader: renderText(template.preheader, fields),
    body: renderText(template.body, fields),
  };
  if (MERGE_RE.test(`${rendered.subject}\n${rendered.preheader}\n${rendered.body}`)) {
    throw new Error(`unresolved nurture merge field: ${templateId}`);
  }
  return rendered;
}

export function flow3MessagePreview() {
  return Object.entries(FLOW_3_POST_INITIAL_TEMPLATES).map(([templateId, template], stepIndex) => ({
    templateId,
    stepIndex,
    audience: template.audience,
    channel: template.channel,
    from: `${template.from.name} <${template.from.email}>`,
    subject: template.subject,
    preheader: template.preheader,
    body: template.body,
  }));
}
