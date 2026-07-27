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
      .profile-grid { display: grid; grid-template-columns: minmax(250px, .8fr) minmax(0, 1.6fr); gap: 14px; }
      .profile-input { width: 100%; min-height: 42px; padding: 9px 11px; border: 1px solid #385244; border-radius: 10px; background: #101813; color: #edf4ef; font: inherit; }
      .profile-input:focus { outline: 2px solid #78d699; outline-offset: 2px; }
      .profile-status { min-height: 20px; margin: 10px 0; color: #9caf9f; font-size: .78rem; }
      .profile-button { width: 100%; padding: 10px; border: 1px solid #385b45; border-radius: 9px; background: #202c24; color: #e7f4ea; cursor: pointer; text-align: left; font: 650 .8rem/1.25 ui-sans-serif, system-ui, sans-serif; }
      .profile-button span { display: block; margin-top: 4px; color: #9caf9f; font-size: .72rem; font-weight: 400; overflow-wrap: anywhere; }
      .profile-panel { min-height: 300px; }
      .profile-heading { margin: 0; font-size: 1.1rem; }
      .profile-meta { margin: 7px 0 0; color: #9caf9f; font-size: .78rem; line-height: 1.45; overflow-wrap: anywhere; }
      .profile-facts { display: flex; flex-wrap: wrap; gap: 7px; margin: 14px 0 0; }
      .profile-fact { padding: 6px 8px; border-radius: 999px; background: #26362d; color: #c5ddcb; font-size: .72rem; }
      .profile-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 22px; }
      .profile-sections h4 { margin: 0 0 8px; font-size: .82rem; }
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
      @media (max-width: 720px) { main { padding-top: 36px; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .review-grid, .operations-grid, .profile-grid, .profile-sections { grid-template-columns: 1fr; } }
      @media (max-width: 420px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Read-only operator view</div>
      <h1>CRM mirror<br />health</h1>
      <p class="lede">A focused view of the data copied from GoHighLevel and Stripe. It has no client messaging, booking, or automated ledger-posting capability.</p>
      <div class="state" id="state"><span class="dot"></span><span>__SERVER_STATE__</span></div>

      <div class="grid" aria-label="Mirror data counts">
        <article class="card"><span class="label">Contacts</span><strong class="value" id="contacts">__SERVER_CONTACTS__</strong><span class="detail">Copied from GoHighLevel</span></article>
        <article class="card"><span class="label">Appointments</span><strong class="value" id="appointments">__SERVER_APPOINTMENTS__</strong><span class="detail">Calendar records observed in GHL</span></article>
        <article class="card"><span class="label">Purchases</span><strong class="value" id="purchases">__SERVER_PURCHASES__</strong><span class="detail">Settled Stripe charges</span></article>
        <article class="card"><span class="label">Sync health</span><strong class="value" id="last-import">__SERVER_SYNC_HEALTH__</strong><span class="detail" id="last-import-detail">__SERVER_SYNC_DETAIL__</span></article>
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
        <h2>Mirror readiness</h2>
        <p>Evidence that the mirror is complete enough to trust: full source passes, bounded communication and consent history, payment-identity exceptions, and Cloudflare recovery readiness. These are alerts, not live operating controls.</p>
        <div class="grid">
          <article class="card"><span class="label">GHL full pass</span><strong class="value" id="ready-ghl">—</strong><span class="detail" id="ready-ghl-detail">Waiting for the first tracked full pass</span></article>
          <article class="card"><span class="label">Stripe full pass</span><strong class="value" id="ready-stripe">—</strong><span class="detail" id="ready-stripe-detail">Waiting for the first tracked full pass</span></article>
          <article class="card"><span class="label">History mirrored</span><strong class="value" id="ready-history">—</strong><span class="detail">Communication and consent observations</span></article>
          <article class="card"><span class="label">Open exceptions</span><strong class="value" id="ready-exceptions">—</strong><span class="detail" id="ready-exceptions-detail">Payment identity and mirror-health alerts</span></article>
        </div>
        <article class="review-shell section"><div class="review-core"><h3>Open mirror alerts</h3><p>These close only when a later observation is healthy. No alert changes source data.</p><ul class="review-list" id="ready-alerts"></ul></div></article>
      </section>

      <section class="section">
        <h2>Ledger cutover review</h2>
        <p>These are proposed opening balances copied from the current GHL fields. Approving a proposal only records the cutover decision—it does not create a ledger entry or change any client balance.</p>
        <div class="grid">
          <article class="card"><span class="label">Pending proposals</span><strong class="value" id="cutover-pending">—</strong><span class="detail">Active clients awaiting opening-balance review</span></article>
          <article class="card"><span class="label">Approved proposals</span><strong class="value" id="cutover-approved">—</strong><span class="detail">Decision recorded; ledger still off</span></article>
          <article class="card"><span class="label">Shadow ledger entries</span><strong class="value" id="cutover-ledger">—</strong><span class="detail">Monitoring only; GHL remains production</span></article>
        </div>
        <article class="review-shell section"><div class="review-core"><h3>Proposed opening balances</h3><p>Approve only after the imported current balance is correct. A separate elevated review session is required; neither outcome writes the ledger.</p><ul class="review-list" id="ledger-cutover-candidates"></ul></div></article>
      </section>

      <section class="section">
        <h2>Client profiles</h2>
        <p>Search a client to view the imported contact record, current GHL balance, purchases, and appointment timeline. This workspace is read-only.</p>
        <div class="profile-grid">
          <article class="review-shell"><div class="review-core"><h3>Find a client</h3><p>Search by name, email, or phone.</p><input class="profile-input" id="contact-search" type="search" autocomplete="off" placeholder="Type at least 2 characters" aria-label="Search clients" /><p class="profile-status" id="contact-search-status">Start typing to search.</p><ul class="review-list" id="contact-search-results"></ul></div></article>
          <article class="review-shell"><div class="review-core profile-panel" id="contact-profile"><h3 class="profile-heading">Select a client</h3><p class="profile-meta">Their imported record will appear here. No profile action can change a balance, booking, or source system.</p></div></article>
        </div>
      </section>

      <section class="section">
        <h2>Shadow operations</h2>
        <p>Three pre-cutover foundations: compare approved opening balances with observed GHL balances, retain an immutable Stripe charge/refund trail, and surface bookings without a recorded outcome. This is observation only—there are no attendance, balance, booking, or payment controls here.</p>
        <div class="grid">
          <article class="card"><span class="label">Balance drift</span><strong class="value" id="shadow-balance-drift">—</strong><span class="detail">Observed GHL balance vs. shadow ledger</span></article>
          <article class="card"><span class="label">Stripe source events</span><strong class="value" id="shadow-payment-events">—</strong><span class="detail">Immutable charges and refund deltas</span></article>
          <article class="card"><span class="label">Booking outcomes missing</span><strong class="value" id="shadow-outcome-gaps">—</strong><span class="detail">Past booking still marked booked/confirmed</span></article>
          <article class="card"><span class="label">Ledger posting</span><strong class="value" id="shadow-ledger-posting">Off</strong><span class="detail">No inferred credits or attendance debits</span></article>
        </div>
        <div class="review-grid section">
          <article class="review-shell"><div class="review-core"><h3>Balance comparisons</h3><p>Only the seven approved opening balances are compared. A difference is a review signal, not a correction.</p><ul class="review-list" id="shadow-balance-comparisons"></ul></div></article>
          <article class="review-shell"><div class="review-core"><h3>Booking outcome gaps</h3><p>GHL has not yet reported attended, cancelled, or no-show. No session debit is inferred.</p><ul class="review-list" id="shadow-outcome-list"></ul></div></article>
          <article class="review-shell"><div class="review-core"><h3>Recent source money events</h3><p>Stripe facts only. They do not create package credits in the shadow ledger.</p><ul class="review-list" id="shadow-payment-list"></ul></div></article>
        </div>
      </section>

      <section class="section">
        <h2>Purchase records</h2>
        <p>Stripe purchases are imported as records. Session-ledger posting is deliberately off during the mirror phase, so this is not a work queue.</p>
        <div class="grid">
          <article class="card"><span class="label">Imported purchases</span><strong class="value" id="pending-review">—</strong><span class="detail">No session credits or ledger entries created</span></article>
          <article class="card"><span class="label">Review candidates</span><strong class="value" id="candidates">—</strong><span class="detail">Exact email evidence, pending review</span></article>
          <article class="card"><span class="label">Unclassified products</span><strong class="value" id="unclassified">—</strong><span class="detail">Needs a historical or current-product decision</span></article>
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
          <article class="review-shell"><div class="review-core"><h3>Product classification</h3><p>Historical packages can be recorded without assigning a modern session count or balance.</p><ul class="review-list" id="review-unclassified"></ul></div></article>
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
          const [statusResponse, readinessResponse, operationsResponse, shadowOperationsResponse, cutoverResponse, reconciliationResponse, reviewResponse, reviewSessionResponse] = await Promise.all([
            fetch("/status", { credentials: "same-origin" }),
            fetch("/readiness", { credentials: "same-origin" }),
            fetch("/operations?limit=25", { credentials: "same-origin" }),
            fetch("/shadow-operations?limit=25", { credentials: "same-origin" }),
            fetch("/ledger-cutover?limit=25", { credentials: "same-origin" }),
            fetch("/reconciliation", { credentials: "same-origin" }),
            fetch("/reconciliation/review?limit=50", { credentials: "same-origin" }),
            fetch("/review-session", { credentials: "same-origin" }),
          ]);
          if (!statusResponse.ok || !readinessResponse.ok || !operationsResponse.ok || !shadowOperationsResponse.ok || !cutoverResponse.ok || !reconciliationResponse.ok || !reviewResponse.ok || !reviewSessionResponse.ok) throw new Error("operator access was denied");
          const status = await statusResponse.json();
          const readiness = await readinessResponse.json();
          const operations = await operationsResponse.json();
          const shadowOperations = await shadowOperationsResponse.json();
          const cutover = await cutoverResponse.json();
          const reconciliation = await reconciliationResponse.json();
          const review = await reviewResponse.json();
          const reviewSession = await reviewSessionResponse.json();
          const set = (id, value) => { document.getElementById(id).textContent = String(value); };
          set("contacts", status.contacts);
          set("appointments", status.appointments);
          set("purchases", status.purchases);
          set("active-clients", operations.totalActiveClients);
          set("upcoming-appointments", operations.totalUpcomingAppointments);
          set("cutover-pending", cutover.pending);
          set("cutover-approved", cutover.approved);
          set("cutover-ledger", cutover.shadowOpeningEntries);
          set("pending-review", reconciliation.pendingLedgerReview);
          set("candidates", reconciliation.pendingCandidates);
          set("unclassified", reconciliation.unclassified);
          set("posting", reconciliation.automaticLedgerPosting ? "On" : "Off");
          const completenessLabel = (source) => source?.state === "complete" ? "Complete" : source?.state === "review" ? "Review" : "Watching";
          const completenessDetail = (source) => source?.state === "complete" ? source.records_seen + " / " + source.known_records + " known records" : "Waiting for the first tracked full pass";
          set("ready-ghl", completenessLabel(readiness.completeness.ghl));
          set("ready-stripe", completenessLabel(readiness.completeness.stripe));
          document.getElementById("ready-ghl-detail").textContent = completenessDetail(readiness.completeness.ghl);
          document.getElementById("ready-stripe-detail").textContent = completenessDetail(readiness.completeness.stripe);
          set("ready-history", readiness.communications + " / " + readiness.consentObservations);
          set("ready-exceptions", readiness.openPaymentIdentityExceptions + readiness.openHealthEvents.filter((event) => event.state !== "healthy").length);
          document.getElementById("ready-exceptions-detail").textContent = (readiness.recovery.result === "ready" ? "Recovery check ready" : "Recovery check not yet recorded") + " · no source writes";
          set("shadow-balance-drift", shadowOperations.balances.driftCount);
          set("shadow-payment-events", shadowOperations.payments.sourceEventCount);
          set("shadow-outcome-gaps", shadowOperations.bookings.pastOutcomeGapCount);
          set("shadow-ledger-posting", shadowOperations.automaticLedgerPosting ? "On" : "Off");
          const syncHealth = status.syncHealth || { overall: "waiting", providers: {} };
          set("last-import", syncHealth.overall === "healthy" ? "Healthy" : syncHealth.overall === "waiting" ? "Waiting" : "Review");
          document.getElementById("last-import-detail").textContent = ["ghl", "stripe"].map((provider) => {
            const source = syncHealth.providers?.[provider];
            if (!source || source.state === "missing") return provider.toUpperCase() + " has not run";
            const age = source.ageMinutes == null ? "time unavailable" : source.ageMinutes + "m ago";
            return provider.toUpperCase() + " " + source.state + " · " + age;
          }).join(" · ");
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
          const contactSearch = document.getElementById("contact-search");
          const contactSearchStatus = document.getElementById("contact-search-status");
          const contactSearchResults = document.getElementById("contact-search-results");
          const contactProfilePanel = document.getElementById("contact-profile");
          const textNode = (tag, value, className) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            node.textContent = value;
            return node;
          };
          const appendList = (parent, rows, format) => {
            const list = document.createElement("ul");
            list.className = "review-list";
            if (!rows.length) {
              list.append(textNode("li", "Nothing recorded.", "review-empty"));
            } else {
              for (const row of rows) {
                const item = document.createElement("li");
                item.className = "review-item";
                const values = format(row);
                item.append(textNode("strong", values[0]), textNode("span", values[1]));
                list.append(item);
              }
            }
            parent.append(list);
          };
          const loadProfile = async (contactId) => {
            contactProfilePanel.replaceChildren(textNode("p", "Loading client profile…", "profile-meta"));
            const response = await fetch("/contacts/" + encodeURIComponent(contactId) + "?limit=25", { credentials: "same-origin" });
            if (!response.ok) {
              contactProfilePanel.replaceChildren(textNode("p", "This client profile could not be loaded.", "profile-meta"));
              return;
            }
            const profile = await response.json();
            const contact = profile.contact;
            contactProfilePanel.replaceChildren();
            contactProfilePanel.append(textNode("h3", contact.display_name || "Unnamed client", "profile-heading"));
            const contactDetail = [contact.email_normalized, contact.phone_e164, contact.referral_source_label].filter(Boolean).join(" · ") || "No imported contact details";
            contactProfilePanel.append(textNode("p", contactDetail, "profile-meta"));
            const facts = document.createElement("div");
            facts.className = "profile-facts";
            const stateFacts = [
              profile.importedCurrentState.sessions_remaining != null ? profile.importedCurrentState.sessions_remaining + " imported sessions remaining" : "No imported balance",
              profile.importedCurrentState.series_type || "No series type",
              profile.nextAppointment ? "Next: " + scheduleTime(profile.nextAppointment.starts_at) : "No upcoming appointment",
              ...profile.roles,
              ...profile.tags,
            ];
            for (const fact of stateFacts) facts.append(textNode("span", fact, "profile-fact"));
            contactProfilePanel.append(facts);
            const sections = document.createElement("div");
            sections.className = "profile-sections";
            const appointments = document.createElement("div");
            appointments.append(textNode("h4", "Appointment timeline"));
            appendList(appointments, profile.appointments, (row) => [scheduleTime(row.starts_at), (row.service_name || "Unmapped service") + " · " + row.status]);
            const purchases = document.createElement("div");
            purchases.append(textNode("h4", "Purchase history"));
            appendList(purchases, profile.purchases, (row) => [money(row) + " · " + (row.classification || "Unclassified"), scheduleTime(row.purchased_at) + " · " + row.provider_status]);
            sections.append(appointments, purchases);
            contactProfilePanel.append(sections);
          };
          let searchTimer;
          let searchRequest = 0;
          contactSearch.addEventListener("input", () => {
            clearTimeout(searchTimer);
            const query = contactSearch.value.trim();
            if (!query) {
              contactSearchStatus.textContent = "Start typing to search.";
              contactSearchResults.replaceChildren();
              return;
            }
            if (query.length < 2) {
              contactSearchStatus.textContent = "Enter at least 2 characters.";
              contactSearchResults.replaceChildren();
              return;
            }
            searchTimer = setTimeout(async () => {
              const requestId = ++searchRequest;
              contactSearchStatus.textContent = "Searching…";
              const response = await fetch("/contacts?limit=12&query=" + encodeURIComponent(query), { credentials: "same-origin" });
              if (requestId !== searchRequest) return;
              if (!response.ok) {
                contactSearchStatus.textContent = "Search is unavailable.";
                return;
              }
              const payload = await response.json();
              contactSearchResults.replaceChildren();
              contactSearchStatus.textContent = payload.contacts.length ? payload.contacts.length + " matching client" + (payload.contacts.length === 1 ? "" : "s") + "." : "No matching clients.";
              for (const contact of payload.contacts) {
                const item = document.createElement("li");
                const button = document.createElement("button");
                button.className = "profile-button";
                button.append(textNode("span", contact.display_name || "Unnamed client"), textNode("span", contact.email_normalized || contact.phone_e164 || "No imported contact detail"));
                button.addEventListener("click", () => loadProfile(contact.id));
                item.append(button);
                contactSearchResults.append(item);
              }
            }, 180);
          });
          render("active-client-list", operations.activeClients, (row) => row.display_name || "Unnamed client", (row) => row.sessions_remaining + " sessions remaining · " + (row.series_type || "series not set") + " · " + (row.next_appointment_at ? scheduleTime(row.next_appointment_at) : "No upcoming appointment"));
          render("upcoming-appointment-list", operations.upcomingAppointments, (row) => row.display_name || "Unnamed client", (row) => scheduleTime(row.starts_at) + " · " + (row.service_name || "Unmapped service") + " · " + row.status);
          render("ready-alerts", readiness.openHealthEvents.filter((event) => event.state !== "healthy"), (row) => row.health_key.replaceAll(":", " · "), (row) => row.detail);
          render("shadow-balance-comparisons", shadowOperations.balances.comparisons, (row) => row.display_name || "Unnamed client", (row) => {
            if (row.state === "awaiting_source_observation") return row.shadow_credits + " shadow sessions · awaiting first GHL observation";
            if (row.state === "in_sync") return row.imported_sessions_remaining + " GHL sessions · matches shadow balance";
            return row.imported_sessions_remaining + " GHL sessions vs " + row.shadow_credits + " shadow · " + Math.abs(row.difference) + " session difference";
          });
          render("shadow-outcome-list", shadowOperations.bookings.pastOutcomeGaps, (row) => row.display_name || "Unnamed client", (row) => scheduleTime(row.starts_at) + " · " + (row.service_name || "Unmapped service") + " · still " + row.status);
          render("shadow-payment-list", shadowOperations.payments.events, (row) => (row.display_name || "Identity unresolved") + " · " + row.event_type.replaceAll("_", " "), (row) => money(row) + " · " + row.classification + " · observed " + scheduleTime(row.observed_at));
          render("ledger-cutover-candidates", cutover.candidates, (row) => row.display_name || row.email_normalized || "Unnamed client", (row) => row.proposed_credits + " proposed opening sessions · " + row.state.replaceAll("_", " "), (item, row) => {
            if (row.state !== "pending_review") return;
            const actions = document.createElement("div");
            actions.className = "action-row";
            const approve = document.createElement("button");
            approve.textContent = "Approve opening balance";
            approve.addEventListener("click", () => perform("/ledger-cutover/candidates/" + encodeURIComponent(row.candidate_id) + "/decision", { decision: "approve" }));
            const reject = document.createElement("button");
            reject.className = "danger";
            reject.textContent = "Reject";
            reject.addEventListener("click", () => perform("/ledger-cutover/candidates/" + encodeURIComponent(row.candidate_id) + "/decision", { decision: "reject" }));
            actions.append(approve, reject);
            item.append(actions);
          });
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
            const legacy = document.createElement("button");
            legacy.textContent = "Mark legacy package";
            legacy.addEventListener("click", () => perform("/purchases/" + encodeURIComponent(row.purchase_id) + "/classification", { resolution: "legacy_package" }));
            const notPackage = document.createElement("button");
            notPackage.className = "danger";
            notPackage.textContent = "Not a session package";
            notPackage.addEventListener("click", () => perform("/purchases/" + encodeURIComponent(row.purchase_id) + "/classification", { resolution: "not_a_package" }));
            actions.append(selector, confirm, legacy, notPackage);
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

function initialSummary(status) {
  if (!status) {
    return {
      state: "Waiting for operator access",
      contacts: "—",
      appointments: "—",
      purchases: "—",
      health: "—",
      healthDetail: "Open a protected operator session to load source health",
    };
  }
  const health = status.syncHealth || { overall: "waiting", providers: {} };
  const sourceDetail = ["ghl", "stripe"].map((provider) => {
    const source = health.providers?.[provider];
    if (!source || source.state === "missing") return `${provider.toUpperCase()} has not run`;
    const age = source.ageMinutes == null ? "time unavailable" : `${source.ageMinutes}m ago`;
    return `${provider.toUpperCase()} ${source.state} · ${age}`;
  }).join(" · ");
  return {
    state: "Protected server summary loaded · no sender actions available",
    contacts: String(status.contacts ?? "—"),
    appointments: String(status.appointments ?? "—"),
    purchases: String(status.purchases ?? "—"),
    health: health.overall === "healthy" ? "Healthy" : health.overall === "waiting" ? "Waiting" : "Review",
    healthDetail: sourceDetail,
  };
}

export function dashboardHtml(status = null) {
  const summary = initialSummary(status);
  return DASHBOARD_HTML
    .replaceAll("__SERVER_STATE__", summary.state)
    .replaceAll("__SERVER_CONTACTS__", summary.contacts)
    .replaceAll("__SERVER_APPOINTMENTS__", summary.appointments)
    .replaceAll("__SERVER_PURCHASES__", summary.purchases)
    .replaceAll("__SERVER_SYNC_HEALTH__", summary.health)
    .replaceAll("__SERVER_SYNC_DETAIL__", summary.healthDetail);
}
