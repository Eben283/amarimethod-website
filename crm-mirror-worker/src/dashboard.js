const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Amari CRM Mirror</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111815; color: #edf4ef; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; background: radial-gradient(circle at top right, #1c3f31 0, transparent 34rem), #111815; }
      main { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 52px 0 72px; }
      .eyebrow { color: #8fd4ac; font-size: .74rem; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
      h1 { max-width: 700px; margin: 12px 0 10px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.4rem, 6vw, 4.7rem); font-weight: 400; letter-spacing: -.045em; line-height: .98; }
      .lede { max-width: 620px; margin: 0; color: #aec0b4; font-size: 1.05rem; line-height: 1.6; }
      .state { display: inline-flex; align-items: center; gap: 8px; margin: 30px 0; padding: 9px 12px; border: 1px solid #31523e; border-radius: 999px; background: #173222; color: #b7e8c7; font-size: .86rem; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #78d699; box-shadow: 0 0 0 4px #245137; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .card { min-height: 136px; padding: 20px; border: 1px solid #2d3d34; border-radius: 16px; background: linear-gradient(145deg, #1b251f, #151d19); }
      .label { color: #8da398; font-size: .8rem; font-weight: 650; letter-spacing: .03em; }
      .value { display: block; margin-top: 15px; font-family: Georgia, "Times New Roman", serif; font-size: 2.45rem; line-height: 1; }
      .detail { display: block; margin-top: 9px; color: #a6b8ac; font-size: .78rem; line-height: 1.35; }
      .section { margin-top: 46px; }
      h2 { margin: 0 0 8px; font-size: 1.22rem; letter-spacing: -.02em; }
      .section > p { margin: 0 0 16px; color: #a6b8ac; line-height: 1.55; }
      .notice { display: flex; align-items: flex-start; gap: 12px; padding: 18px; border: 1px solid #694e26; border-radius: 14px; background: #2d2416; color: #f1d59b; line-height: 1.45; }
      .notice strong { color: #fff0c8; }
      .footer { margin-top: 46px; color: #708378; font-size: .8rem; }
      @media (max-width: 720px) { main { padding-top: 36px; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 420px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Read-only operator view</div>
      <h1>CRM mirror<br />health</h1>
      <p class="lede">A focused view of the data copied from GoHighLevel and Stripe. It has no sending, scheduling, or automated ledger-posting capability.</p>
      <div class="state" id="state"><span class="dot"></span><span>Waiting for operator access</span></div>

      <div class="grid" aria-label="Mirror data counts">
        <article class="card"><span class="label">Contacts</span><strong class="value" id="contacts">—</strong><span class="detail">Copied from GoHighLevel</span></article>
        <article class="card"><span class="label">Appointments</span><strong class="value" id="appointments">—</strong><span class="detail">Calendar records observed in GHL</span></article>
        <article class="card"><span class="label">Purchases</span><strong class="value" id="purchases">—</strong><span class="detail">Settled Stripe charges</span></article>
        <article class="card"><span class="label">Last import</span><strong class="value" id="last-import">—</strong><span class="detail" id="last-import-detail">No source status loaded</span></article>
      </div>

      <section class="section">
        <h2>Reconciliation queue</h2>
        <p>Purchases stay out of the session ledger until an operator can account for them correctly.</p>
        <div class="grid">
          <article class="card"><span class="label">Pending review</span><strong class="value" id="pending-review">—</strong><span class="detail">No ledger entries have been created</span></article>
          <article class="card"><span class="label">Review candidates</span><strong class="value" id="candidates">—</strong><span class="detail">Exact email evidence, pending review</span></article>
          <article class="card"><span class="label">Unclassified</span><strong class="value" id="unclassified">—</strong><span class="detail">Needs package identification</span></article>
          <article class="card"><span class="label">Automatic posting</span><strong class="value" id="posting">Off</strong><span class="detail">Deliberately disabled</span></article>
        </div>
      </section>

      <div class="notice"><span aria-hidden="true">✓</span><div><strong>Safe by design.</strong> This mirror only imports source data. It cannot send email or SMS, create appointments, update GoHighLevel, or alter a client’s session balance.</div></div>
      <p class="footer">Aggregate counts are shown only after protected operator access. This page intentionally contains no contact or payment details.</p>
    </main>
    <script>
      (async () => {
        const token = new URLSearchParams(location.hash.slice(1)).get("access_token");
        const state = document.querySelector("#state span:last-child");
        if (!token) {
          state.textContent = "Open this view through the protected operator link";
          return;
        }
        history.replaceState(null, "", location.pathname);
        try {
          const headers = { Authorization: "Bearer " + token };
          const [statusResponse, reconciliationResponse] = await Promise.all([
            fetch("/status", { headers }),
            fetch("/reconciliation", { headers }),
          ]);
          if (!statusResponse.ok || !reconciliationResponse.ok) throw new Error("operator access was denied");
          const status = await statusResponse.json();
          const reconciliation = await reconciliationResponse.json();
          const set = (id, value) => { document.getElementById(id).textContent = String(value); };
          set("contacts", status.contacts);
          set("appointments", status.appointments);
          set("purchases", status.purchases);
          set("pending-review", reconciliation.pendingLedgerReview);
          set("candidates", reconciliation.pendingCandidates);
          set("unclassified", reconciliation.unclassified);
          set("posting", reconciliation.automaticLedgerPosting ? "On" : "Off");
          set("last-import", status.lastSync?.status === "succeeded" ? "Current" : "Review");
          document.getElementById("last-import-detail").textContent = status.lastSync?.finished_at
            ? "GHL import " + status.lastSync.status + " · " + new Date(status.lastSync.finished_at).toLocaleString()
            : "No completed import reported";
          state.textContent = "Protected data loaded · no sender actions available";
        } catch (error) {
          state.textContent = "Unable to load protected mirror data";
        }
      })();
    </script>
  </body>
</html>`;

export function dashboardHtml() {
  return DASHBOARD_HTML;
}
