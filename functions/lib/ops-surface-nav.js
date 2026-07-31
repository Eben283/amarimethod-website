// Shared tab chrome for the three operator surfaces (Systems / CRM Mirror / Automation Watch).
// Used by /ops, CRM mirror dashboard, and Automation Watch dashboard so deep links stay linked.

export const OPS_SURFACE_URLS = Object.freeze({
  systems: "https://www.amarimethod.com/ops",
  crmMirror: "https://amari-crm-mirror.eben-fa2.workers.dev/",
  automation: "https://reminder-engine.eben-fa2.workers.dev/dashboard",
  staffHub: "https://www.amarimethod.com/staff/operations",
});

/** @param {"systems"|"crm"|"automation"} active */
export function opsSurfaceNavHtml(active) {
  const item = (id, href, label) => {
    const current = id === active ? ' aria-current="page"' : "";
    return `<a class="ops-surface-tab" href="${href}"${current}>${label}</a>`;
  };
  return `
<nav class="ops-surface-nav" aria-label="Operator surfaces">
  <div class="ops-surface-nav__tabs">
    ${item("systems", OPS_SURFACE_URLS.systems, "Systems")}
    ${item("crm", OPS_SURFACE_URLS.crmMirror, "CRM Mirror")}
    ${item("automation", OPS_SURFACE_URLS.automation, "Automation Watch")}
  </div>
  <a class="ops-surface-nav__hub" href="${OPS_SURFACE_URLS.staffHub}">Staff hub</a>
</nav>`;
}

export const OPS_SURFACE_NAV_CSS = `
  .ops-surface-nav {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 10px 16px; margin: 0 0 22px; padding: 8px;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, #ffffff 55%, transparent);
  }
  .ops-surface-nav__tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .ops-surface-tab {
    display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px;
    border-radius: 9px; color: inherit; text-decoration: none;
    font: 650 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em;
    opacity: .72;
  }
  .ops-surface-tab:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
  .ops-surface-tab[aria-current="page"] {
    opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .ops-surface-nav__hub {
    color: inherit; opacity: .55; text-decoration: none;
    font: 500 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase;
  }
  .ops-surface-nav__hub:hover { opacity: .9; }
  body.ops-embed .ops-surface-nav,
  body.ops-embed .ops-embed-hide { display: none !important; }
`;

export function opsEmbedBootScript() {
  return `(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("embed") === "1" || window !== window.top) document.body.classList.add("ops-embed");
  })();`;
}
