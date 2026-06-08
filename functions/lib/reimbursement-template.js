// Pure HTML template for the insurance reimbursement packet. No request/auth
// deps, so it can be unit-tested and previewed outside the Pages Function.
// Consumed by functions/api/portal-reimbursement-packet.js.

// Practice details for the letterhead. A future productized version swaps these
// per practice (config), which is why they live in one object.
export const PRACTICE = {
  name: "Amari Method",
  phone: "(628) 877-7673",
  email: "hello@amarimethod.com",
  website: "www.amarimethod.com",
  addressLines: ["662 8th Avenue", "San Francisco, CA 94118", "United States"],
  signerName: "Eben Forrest",
  signerTitle: "Office Administrator",
};

// Escape user-supplied text before interpolating into the HTML document.
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  // UTC so a date stored at T07:00:00Z (midnight Pacific) doesn't slip a day.
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function money(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Format a US phone for display: "+19253239061" -> "(925) 323-9061".
export function formatPhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return p || "";
}

export function renderPacket({ patientName, patientPhone, datesOfService, paidInvoices, today }) {
  const addr = PRACTICE.addressLines.map(esc).join("<br>");

  const coverLetter = `
    <section class="page">
      <h1 class="doc-title">Insurance Reimbursement Supporting Documentation</h1>
      <div class="meta">
        <div><strong>Patient:</strong> ${esc(patientName)}</div>
        <div><strong>Provider:</strong> ${esc(PRACTICE.name)}</div>
        <div><strong>Contact:</strong> ${esc(PRACTICE.phone)}</div>
      </div>
      <p>To Whom It May Concern,</p>
      <p>Attached please find documentation submitted for insurance reimbursement review, including:</p>
      <ul>
        <li>Itemized invoices</li>
        <li>Proof of payment</li>
        <li>Letter of Medical Services describing the nature of care provided</li>
      </ul>
      <p>The services described were provider-guided neuromusculoskeletal care rendered in a
      one-on-one clinical setting and are not billed directly to insurance. This documentation is
      provided to assist with classification and review.</p>
      <p>Please contact our office if additional information is required.</p>
      <p class="sig">Sincerely,</p>
      <p class="sig-name">${esc(PRACTICE.signerName)}<br>${esc(PRACTICE.signerTitle)}<br>${esc(PRACTICE.name)}</p>
    </section>`;

  const medicalLetter = `
    <section class="page">
      <header class="letterhead">
        <div class="lh-name">${esc(PRACTICE.name)}</div>
        <div class="lh-contact">
          ${addr}<br><br>
          ${esc(PRACTICE.phone)}<br>
          ${esc(PRACTICE.email)}<br>
          ${esc(PRACTICE.website)}
        </div>
      </header>
      <div class="meta">
        <div><strong>Date:</strong> ${esc(today)}</div>
        <div style="margin-top:10px"><strong>Re:</strong> Letter of Medical Services</div>
        <div><strong>Patient:</strong> ${esc(patientName)}</div>
        <div><strong>Dates of Service:</strong> ${esc(datesOfService.join("; "))}</div>
      </div>
      <p>To Whom It May Concern,</p>
      <p>This letter is provided to clarify the nature of services rendered to ${esc(patientName)} at
      ${esc(PRACTICE.name)} on the dates listed above.</p>
      <p>${esc(patientName)} received provider-guided follow-up care as part of an ongoing clinical
      program focused on neuromusculoskeletal balance, postural coordination, and nervous system
      regulation. These sessions followed an initial comprehensive assessment and were individualized
      based on observed movement patterns and functional imbalances. Services were rendered as
      provider-guided neuromusculoskeletal care and are not billed directly to insurance.</p>
      <p>An ${esc(PRACTICE.name)} follow-up session is a one-on-one clinical visit that may include:</p>
      <ul>
        <li>Movement-based assessment of musculoskeletal coordination</li>
        <li>Guided therapeutic movement and postural retraining</li>
        <li>Neuromuscular re-education</li>
        <li>Breathing-based nervous system regulation</li>
        <li>Instruction and refinement of corrective movement protocols</li>
      </ul>
      <p>The intent of these sessions is to address patterns of overuse and underuse within the body
      that contribute to pain, tension, or functional limitation, and to provide the patient with
      tools for ongoing self-management.</p>
      <p>Invoices and proof of payment corresponding to these dates of service are attached for
      reference.</p>
      <p>Please contact our office if additional clarification is required.</p>
      <p class="sig">Sincerely,</p>
      <p class="sig-name">${esc(PRACTICE.signerName)}<br>${esc(PRACTICE.signerTitle)}<br>${esc(PRACTICE.name)}</p>
    </section>`;

  const invoicePages = paidInvoices.map((inv) => renderInvoice(inv, patientName, patientPhone)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Insurance Reimbursement Packet — ${esc(patientName)}</title>
<style>
  :root { --ink:#2b2b2b; --muted:#6b6b6b; --rule:#d9d4cc; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f1ede7; color:var(--ink);
    font-family: Georgia, "Times New Roman", serif; line-height:1.55; }
  .toolbar { position:sticky; top:0; display:flex; gap:12px; align-items:center;
    justify-content:center; padding:14px; background:#2b2b2b; color:#fff; }
  .toolbar button { font:inherit; font-family:system-ui,sans-serif; font-size:14px;
    padding:9px 18px; border:0; border-radius:6px; background:#EBA584; color:#2b2b2b;
    font-weight:600; cursor:pointer; }
  .toolbar span { font-family:system-ui,sans-serif; font-size:13px; opacity:.85; }
  .page { background:#fff; width:8.5in; min-height:11in; margin:24px auto;
    padding:0.9in 1in; box-shadow:0 2px 14px rgba(0,0,0,.12); }
  .doc-title { text-align:center; font-size:17px; letter-spacing:.02em;
    border-bottom:1px solid var(--rule); padding-bottom:14px; margin:0 0 34px; }
  .meta { margin-bottom:26px; }
  .meta div { margin:2px 0; }
  p { margin:0 0 16px; font-size:15px; }
  ul { margin:0 0 16px; padding-left:22px; }
  li { margin:3px 0; font-size:15px; }
  .sig { margin-bottom:6px; }
  .sig-name { margin-top:0; }
  .letterhead { display:flex; justify-content:space-between; align-items:flex-start;
    border-bottom:1px solid var(--rule); padding-bottom:20px; margin-bottom:30px; }
  .lh-name { font-size:30px; font-weight:600; letter-spacing:-.01em; }
  .lh-contact { font-family:system-ui,sans-serif; font-size:11px; color:var(--muted);
    text-align:right; line-height:1.5; }
  .inv-head { display:flex; justify-content:space-between; align-items:flex-start;
    border-bottom:2px solid var(--ink); padding-bottom:14px; margin-bottom:24px; }
  .inv-title { font-size:34px; font-weight:300; letter-spacing:.04em; }
  .inv-provider { text-align:right; font-family:system-ui,sans-serif; font-size:11px;
    color:var(--muted); line-height:1.5; }
  .inv-provider .pn { font-size:16px; color:var(--ink); font-weight:600; font-family:Georgia,serif; }
  .inv-cols { display:flex; gap:48px; font-family:system-ui,sans-serif; font-size:12px;
    margin-bottom:28px; }
  .inv-cols .lbl { color:var(--muted); }
  .inv-table { width:100%; border-collapse:collapse; font-family:system-ui,sans-serif; font-size:13px; }
  .inv-table th { text-align:left; color:var(--muted); font-weight:500; font-size:11px;
    letter-spacing:.06em; text-transform:uppercase; border-bottom:1px solid var(--ink); padding:0 0 8px; }
  .inv-table td { padding:14px 0; border-bottom:1px solid var(--rule); vertical-align:top; }
  .inv-table .r { text-align:right; }
  .inv-totals { margin-top:18px; margin-left:auto; width:280px; font-family:system-ui,sans-serif; font-size:13px; }
  .inv-totals .row { display:flex; justify-content:space-between; padding:6px 0; }
  .inv-paid { margin-top:18px; text-align:center; background:#eef5ee; padding:16px;
    border-radius:6px; font-family:system-ui,sans-serif; }
  .inv-paid .big { font-size:16px; font-weight:600; letter-spacing:.04em; }
  .inv-paid .small { font-size:12px; color:var(--muted); margin-top:4px; }
  @media print {
    body { background:#fff; }
    .toolbar { display:none; }
    .page { box-shadow:none; margin:0; width:auto; min-height:auto; padding:0.6in; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
  }
  @page { size: letter; margin: 0; }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">Save as PDF</button>
    <span>Use your browser's print dialog and choose "Save as PDF."</span>
  </div>
  ${coverLetter}
  ${medicalLetter}
  ${invoicePages}
</body>
</html>`;
}

function renderInvoice(inv, patientName, patientPhone) {
  const items = inv.invoiceItems || inv.items || [];
  const rows = items
    .map(
      (it) => `
      <tr>
        <td>${esc(it.name || "Amari Method Session")}</td>
        <td class="r">${esc(money(it.amount))}</td>
        <td class="r">${esc(it.qty ?? 1)}</td>
        <td class="r">${esc(money((Number(it.amount) || 0) * (Number(it.qty) || 1)))}</td>
      </tr>`,
    )
    .join("");

  const completedAt = inv.paidAt || inv.updatedAt || inv.issueDate
    ? formatDate(inv.paidAt || inv.updatedAt || inv.issueDate)
    : "";

  return `
    <section class="page">
      <div class="inv-head">
        <div class="inv-title">INVOICE</div>
        <div class="inv-provider">
          <div class="pn">${esc(PRACTICE.name)}</div>
          ${esc(PRACTICE.phone)}<br>
          ${PRACTICE.addressLines.map(esc).join("<br>")}<br>
          ${esc(PRACTICE.website)}
        </div>
      </div>
      <div class="inv-cols">
        <div>
          <div class="lbl">Billed to</div>
          <div>${esc(patientName)}</div>
          ${patientPhone ? `<div>${esc(patientPhone)}</div>` : ""}
        </div>
        <div>
          <div class="lbl">Invoice No</div>
          <div>INV-${esc(inv.invoiceNumber || "")}</div>
        </div>
        <div>
          <div class="lbl">Issue Date</div>
          <div>${esc(formatDate(inv.issueDate))}</div>
        </div>
      </div>
      <table class="inv-table">
        <thead>
          <tr><th>Item</th><th class="r">Price</th><th class="r">Qty</th><th class="r">Subtotal</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="inv-totals">
        <div class="row"><span class="lbl">Subtotal</span><span>${esc(money(inv.total))}</span></div>
        <div class="row"><span>Amount Paid (USD)</span><span>${esc(money(inv.amountPaid || inv.total))}</span></div>
      </div>
      <div class="inv-paid">
        <div class="big">PAID</div>
        ${completedAt ? `<div class="small">Completed on: ${esc(completedAt)}</div>` : ""}
      </div>
    </section>`;
}
