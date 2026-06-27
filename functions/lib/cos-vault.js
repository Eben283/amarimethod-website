// Reads cos:vault:knowledge from KV and selects which docs to inject
// into the chat system prompt. Tiered: small evergreen docs always go in,
// larger docs only when the user message references them.

const ALWAYS_DOCS = ["positioning", "garrett-voice", "lifecycles", "technical-reference"];

// Each entry: regex that fires the doc when matched against user message
const ON_DEMAND_DOCS = [
  { name: "messaging-templates", trigger: /email|message|template|copy|write|draft|send/i },
  { name: "website-rewrite-brief", trigger: /website|page|homepage|copy|positioning/i },
  { name: "ghl-flow-map", trigger: /workflow|automation|trigger|flow/i },
  { name: "trainer-outreach-talking-points", trigger: /trainer|outreach|partner.{0,4}(prospect|outreach)/i },
  // Sales-closing knowledge behind Sharpen — the NotebookLM Q&A from 7 sales books.
  // Fires on call/closing/objection coaching questions so CoS grounds in the books.
  { name: "sales-closing", trigger: /\b(sell|selling|sales|clos(e|ing|er)|objection|discovery call|pitch|spin selling|gap selling|sharpen|too expensive|think about it|follow.?up|book (him|her|them|the call))\b/i },
  { name: "open-todos", trigger: /todo|open task|what.{0,3}left|priorit/i },
  { name: "condition-back", trigger: /\b(back|spine|lumbar|sciatic)/i },
  { name: "condition-neck", trigger: /\b(neck|cervical)/i },
  { name: "condition-shoulder", trigger: /\bshoulder|rotator/i },
  { name: "condition-hip", trigger: /\bhip|piriformis/i },
  { name: "condition-knee", trigger: /\bknee|patell/i },
];

export async function loadVaultKnowledge(kv) {
  if (!kv) return null;
  try {
    const raw = await kv.get("cos:vault:knowledge");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[cos-vault] load error:", err.message);
    return null;
  }
}

export function buildVaultContext(vaultData, userMessage) {
  if (!vaultData || !vaultData.docs) return null;
  const docs = vaultData.docs;
  const sections = [];

  for (const name of ALWAYS_DOCS) {
    if (docs[name]) {
      sections.push(`### ${name}\n${docs[name]}`);
    }
  }

  for (const { name, trigger } of ON_DEMAND_DOCS) {
    if (docs[name] && trigger.test(userMessage)) {
      sections.push(`### ${name}\n${docs[name]}`);
    }
  }

  if (sections.length === 0) return null;

  const synced = vaultData.synced
    ? new Date(vaultData.synced).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })
    : "unknown";

  return `## Eben's Vault Knowledge (synced ${synced})\n\n${sections.join("\n\n---\n\n")}`;
}
