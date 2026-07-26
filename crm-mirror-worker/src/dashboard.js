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
      .review-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .operations-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .review-shell { padding: 5px; border-radius: 18px; background: #26362d; }
      .review-core { min-height: 220px; padding: 16px; border-radius: 14px; background: #172019; }
      .review-core h3 { margin: 0 0 6px; font-size: .94rem; }
      .review-core > p { margin: 0 0 14px; color: #9caf9f; font-size: .78rem; line-height: 1.45; }
      .review-list { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
      .review-item { padding: 11px; border-radius: 11px; background: #202c24; }
      .review-item strong, .review-item span { display: block; overflow-wrap: anywhere; }
      .review-item strong { color: #e7f4ea; font-size: .82rem; }
      .review-item span { margin-top: 4px; color: #9caf9f; font-size: .73rem; line-height: 1.35; }
      .review-empty { color: #8fa295; font-size: .8rem; line-height: 1.45; }
      .review-tools { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin: 0 0 16px; }
      .review-tools label { display: grid; gap: 5px; color: #9caf9f; font-size: .72rem; }
      .review-tools input, .review-tools select { min-height: 33px; padding: 7px 9px; border: 0; border-radius: 8px; background: #26362d; color: #edf4ef; font: inherit; }
      .action-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
      .action-row button { padding: 7px 9px; border: 0; border-radius: 8px; background: #385b45; color: #edfff2; cursor: pointer; font: 650 .71rem/1 ui-sans-serif, system-ui, sans-serif; }
      .action-row button.danger { background: #6a403a; }
      .action-row button:hover { transform: translateY(-1px); }
      .action-status { color: #f1d59b; font-size: .74rem; line-height: 1.4; }
      .footer { margin-top: 46px; color: #708378; font-size: .8rem; }
      @media (max-width: 720px) { main { padding-top: 36px; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .review-grid, .operations-grid { grid-template-columns: 1fr; } }
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
        <h2>Active client operations</h2>
        <p>Current client balances are imported from GoHighLevel. They are displayed for daily work only; this mirror does not calculate, debit, or create a balance.</p>
        <div class="grid">
          <article class="card"><span class="label">Active balances</span><strong class="value" id="active-clients">—</strong><span class="detail">Positive, GHL-imported session fields</span></article>
          <article class="card"><span class="label">Upcoming appointments</span><strong class="value" id="upcoming-appointments">—</strong><span class="detail">Booked or confirmed in the imported calendar</span></article>
        </div>
        <div class="operations-grid section">
          <article class="review-shell"><div class="review-core"><h3>Clients with sessions remaining</h3><p>Imported balance and the next booked appointment, if any.</p><ul class="review-list" id="active-client-list"></ul></div></article>
          <article class="review-shell"><div class="review-core"><h3>Upcoming appointments</h3><p>Read-only schedule copied from GoHighLevel.</p><ul class="review-list" id="upcoming-appointment-list"></ul></div></article>
        </div>
      </section>

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

      <section class="section">
        <h2>Review workspace</h2>
        <p>Every decision records a reviewer and audit event. No decision creates a session balance; review actions require a separate 15-minute elevated session.</p>
        <div class="review-tools"><label>Reviewer name<input id="reviewer-name" maxlength="100" placeholder="Required for an action" /></label><span class="action-status" id="review-action-status">Read-only until an elevated review session is opened.</span></div>
        <div class="review-grid">
          <article class="review-shell"><div class="review-core"><h3>Exact-email candidates</h3><p>One Stripe customer email exactly matches one contact.</p><ul class="review-list" id="review-candidates"></ul></div></article>
          <article class="review-shell"><div class="review-core"><h3>Unmatched purchases</h3><p>No safe contact evidence is available yet.</p><ul class="review-list" id="review-unmatched"></ul></div></article>
          <article class="review-shell"><div class="review-core"><h3>Unclassified packages</h3><p>Identity may be known; the package still needs a human decision.</p><ul class="review-list" id="review-unclassified"></ul></div></article>
        </div>
      </section>

      <div class="notice"><span aria-hidden="true">✓</span><div><strong>Safe by design.</strong> This mirror only imports source data. It cannot send email or SMS, create appointments, update GoHighLevel, or alter a client’s session balance.</div></div>
      <p class="footer">Aggregate counts are shown only after protected operator access. This page intentionally contains no contact or payment details.</p>
    </main>
    <script>
      (async () => {
        const fragment = new URLSearchParams(location.hash.slice(1));
        const token = fragment.get("access_token");
        const reviewToken = fragment.get("review_access_token");
        const state = document.querySelector("#state span:last-child");
        try {
          if (token) {
            const sessionResponse = await fetch("/dashboard-session", {
              method: "POST",
              headers: { Authorization: "Bearer " + token },
              credentials: "same-origin",
            });
            if (!sessionResponse.ok) throw new Error("operator access was denied");
          }
          if (reviewToken) {
            const reviewSessionResponse = await fetch("/review-session", {
              method: "POST",
              headers: { Authorization: "Bearer " + reviewToken },
              credentials: "same-origin",
            });
            if (!reviewSessionResponse.ok) throw new Error("review access was denied");
          }
          if (token || reviewToken) {
            history.replaceState(null, "", location.pathname + location.search);
          }
          const [statusResponse, operationsResponse, reconciliationResponse, reviewResponse, reviewSessionResponse] = await Promise.all([
            fetch("/status", { credentials: "same-origin" }),
            fetch("/operations?limit=25", { credentials: "same-origin" }),
            fetch("/reconciliation", { credentials: "same-origin" }),
            fetch("/reconciliation/review?limit=50", { credentials: "same-origin" }),
            fetch("/review-session", { credentials: "same-origin" }),
          ]);
          if (!statusResponse.ok || !operationsResponse.ok || !reconciliationResponse.ok || !reviewResponse.ok || !reviewSessionResponse.ok) throw new Error("operator access was denied");
          const status = await statusResponse.json();
          const operations = await operationsResponse.json();
          const reconciliation = await reconciliationResponse.json();
          const review = await reviewResponse.json();
          const reviewSession = await reviewSessionResponse.json();
          const set = (id, value) => { document.getElementById(id).textContent = String(value); };
          set("contacts", status.contacts);
          set("appointments", status.appointments);
          set("purchases", status.purchases);
          set("active-clients", operations.totalActiveClients);
          set("upcoming-appointments", operations.totalUpcomingAppointments);
          set("pending-review", reconciliation.pendingLedgerReview);
          set("candidates", reconciliation.pendingCandidates);
          set("unclassified", reconciliation.unclassified);
          set("posting", reconciliation.automaticLedgerPosting ? "On" : "Off");
          set("last-import", status.lastSync?.status === "succeeded" ? "Current" : "Review");
          document.getElementById("last-import-detail").textContent = status.lastSync?.finished_at
            ? "GHL import " + status.lastSync.status + " · " + new Date(status.lastSync.finished_at).toLocaleString()
            : "No completed import reported";
          const money = (row) => new Intl.NumberFormat("en-US", { style: "currency", currency: (row.currency || "usd").toUpperCase(), maximumFractionDigits: 0 }).format((row.amount_cents || 0) / 100);
          const scheduleTime = (value) => value ? value.replace(" ", " · ").replace(/:00$/, "") : "No upcoming appointment";
          const reviewer = () => document.getElementById("reviewer-name").value.trim();
          const actionStatus = document.getElementById("review-action-status");
          actionStatus.textContent = reviewSession.active
            ? "Elevated review session active for 15 minutes."
            : "Read-only until an elevated review session is opened.";
          const perform = async (path, body) => {
            if (!reviewer()) {
              actionStatus.textContent = "Enter your reviewer name before making a decision.";
              return;
            }
            const response = await fetch(path, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...body, reviewedBy: reviewer() }),
            });
            if (!response.ok) {
              actionStatus.textContent = response.status === 401 ? "An elevated review session is required for changes." : "The review action could not be completed.";
              return;
            }
            window.location.reload();
          };
          const render = (id, rows, title, detail, controls) => {
            const list = document.getElementById(id);
            list.replaceChildren();
            if (!rows.length) {
              const empty = document.createElement("li");
              empty.className = "review-empty";
              empty.textContent = "Nothing in this queue.";
              list.append(empty);
              return;
            }
            for (const row of rows) {
              const item = document.createElement("li");
              item.className = "review-item";
              const heading = document.createElement("strong");
              heading.textContent = title(row);
              const subline = document.createElement("span");
              subline.textContent = detail(row);
              item.append(heading, subline);
              if (controls) controls(item, row);
              list.append(item);
            }
          };
          render("active-client-list", operations.activeClients, (row) => row.display_name || "Unnamed client", (row) => row.sessions_remaining + " sessions remaining · " + (row.series_type || "series not set") + " · " + (row.next_appointment_at ? scheduleTime(row.next_appointment_at) : "No upcoming appointment"));
          render("upcoming-appointment-list", operations.upcomingAppointments, (row) => row.display_name || "Unnamed client", (row) => scheduleTime(row.starts_at) + " · " + (row.service_name || "Unmapped service") + " · " + row.status);
          render("review-candidates", review.candidates, (row) => row.contact_display_name || row.contact_email_normalized, (row) => money(row) + " · " + row.classification + " · " + row.billing_email_normalized, (item, row) => {
            const actions = document.createElement("div");
            actions.className = "action-row";
            const approve = document.createElement("button");
            approve.textContent = "Approve link";
            approve.addEventListener("click", () => perform("/reconciliation/candidates/" + encodeURIComponent(row.candidate_id) + "/decision", { decision: "accept" }));
            const reject = document.createElement("button");
            reject.className = "danger";
            reject.textContent = "Reject";
            reject.addEventListener("click", () => perform("/reconciliation/candidates/" + encodeURIComponent(row.candidate_id) + "/decision", { decision: "reject" }));
            actions.append(approve, reject);
            item.append(actions);
          });
          render("review-unmatched", review.unmatched, (row) => money(row) + " · " + row.classification, (row) => row.billing_email_normalized || "No billing email captured");
          render("review-unclassified", review.unclassified, (row) => row.contact_display_name || row.billing_email_normalized || "Identity unresolved", (row) => money(row) + " · " + row.identity_status.replaceAll("_", " "), (item, row) => {
            const actions = document.createElement("div");
            actions.className = "action-row";
            const selector = document.createElement("select");
            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "Choose package";
            selector.append(placeholder);
            for (const pack of review.packages) {
              const option = document.createElement("option");
              option.value = pack.id;
              option.textContent = pack.name;
              selector.append(option);
            }
            const confirm = document.createElement("button");
            confirm.textContent = "Confirm package";
            confirm.addEventListener("click", () => {
              if (!selector.value) { actionStatus.textContent = "Choose a package before confirming."; return; }
              perform("/purchases/" + encodeURIComponent(row.purchase_id) + "/classification", { resolution: "package", packageId: selector.value });
            });
            const notPackage = document.createElement("button");
            notPackage.className = "danger";
            notPackage.textContent = "Not a session package";
            notPackage.addEventListener("click", () => perform("/purchases/" + encodeURIComponent(row.purchase_id) + "/classification", { resolution: "not_a_package" }));
            actions.append(selector, confirm, notPackage);
            item.append(actions);
          });
          state.textContent = "Protected data loaded · no sender actions available";
        } catch (error) {
          state.textContent = "Protected operator session required";
        }
      })();
    </script>
  </body>
</html>`;

export function dashboardHtml() {
  return DASHBOARD_HTML;
}
