import { ArrowUpRight, Check, Images, MoveUpRight, Palette, Type } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import './DesignSystemPage.css';

type SectionKey = 'overview' | 'foundations' | 'type' | 'copy' | 'photography' | 'print' | 'decisions';

const sections: Array<{ key: SectionKey; label: string; detail: string; path: string }> = [
  { key: 'overview', label: 'Overview', detail: 'The system at a glance', path: '/design-system' },
  { key: 'foundations', label: 'Foundation', detail: 'Feeling, color, mark', path: '/design-system/foundation' },
  { key: 'type', label: 'Type standards', detail: 'Sizes, spacing, minimums', path: '/design-system/type' },
  { key: 'copy', label: 'Copy system', detail: 'Order, claims, language', path: '/design-system/copy' },
  { key: 'photography', label: 'Photography', detail: 'What to show', path: '/design-system/photography' },
  { key: 'print', label: 'Print standards', detail: 'Three approved pieces', path: '/design-system/print' },
  { key: 'decisions', label: 'Decision record', detail: 'What is locked and why', path: '/design-system/decisions' },
];

const resolveSection = (pathname: string): SectionKey => {
  const match = sections.find((section) => section.path !== '/design-system' && pathname.startsWith(section.path));
  return match?.key ?? 'overview';
};

function SectionHeader({ index, title, body }: { index: string; title: string; body: string }) {
  return <header className="amari-design-system__section-header"><p>{index}</p><h2>{title}</h2><span>{body}</span></header>;
}

function Overview() {
  return <>
    <section className="amari-design-system__hero">
      <div className="amari-design-system__intro">
        <p className="amari-design-system__eyebrow">Amari Method · internal reference</p>
        <h1>Design<br />system.</h1>
        <p>The shared visual and verbal system for every public-facing Amari surface. Use the pages at right before making a new piece or changing an existing one.</p>
      </div>
      <div className="amari-design-system__promise" aria-label="Amari Method creative anchor">
        <img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" />
        <p>Subtle input.<br />Unmistakable result.</p>
        <span>San Francisco</span>
      </div>
    </section>
    <section className="amari-design-system__overview-grid">
      <article><span>Promise</span><strong>Subtle input.<br />Unmistakable result.</strong><p>The organizing creative thought. It is not a replacement for explaining the practice.</p></article>
      <article><span>What it is</span><strong>Private, hands-on guided movement</strong><p>Use the literal description wherever a person needs to understand the offering.</p></article>
      <article><span>Test</span><strong>Grounded.<br />Exact.<br />Capable.</strong><p>Never spa-like, medical-tech, generic fitness, or luxury-club theatre.</p></article>
    </section>
    <section className="amari-design-system__quick-start">
      <SectionHeader index="START HERE" title="One system. Clear jobs." body="A piece should make one main thought unmistakable, then give the reader only the next piece of information they need." />
      <div className="amari-design-system__quick-start-rules">
        <p><b>1</b><span><strong>Choose the job</strong>Identity and contact; intrigue then clarity; or immediate understanding.</span></p>
        <p><b>2</b><span><strong>Choose the approved type scale</strong>Never make contact information small to fit more copy.</span></p>
        <p><b>3</b><span><strong>Use actual practice imagery</strong>Protect the face, the hands, and the point of contact.</span></p>
      </div>
    </section>
  </>;
}

function Foundation() {
  return <>
    <SectionHeader index="01 / FOUNDATION" title="Quiet precision, not wellness theater." body="The visual system should feel materially restrained and physically credible before it feels premium." />
    <section className="amari-design-system__principle-grid">
      {[['Grounded', 'Real bodies, ordinary considered settings, and exact language.'], ['Editorial', 'One strong thought at a time, with room for it to land.'], ['Capable', 'Private, hands-on, and precise — never clinical or gym-branded.']].map(([title, description], index) => <article key={title}><b>0{index + 1}</b><h3>{title}</h3><p>{description}</p></article>)}
    </section>
    <section className="amari-design-system__foundation-layout">
      <div className="amari-design-system__palette"><p>Core palette</p><div className="amari-design-system__swatches"><article className="amari-design-system__swatch amari-design-system__swatch--ink"><span>Ink</span><strong>#171A18</strong><small>Dark fields, type, rules, QR modules</small></article><article className="amari-design-system__swatch amari-design-system__swatch--paper"><span>Warm paper</span><strong>#F4F3EE</strong><small>Light fields and reversed ground</small></article></div><em>Start in ink and warm paper. Do not introduce a color system to make a piece feel finished.</em></div>
      <div className="amari-design-system__mark-rules"><p>Wordmark</p><img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method wordmark" /><ul><li>Use the supplied asset; do not typeset or redraw it.</li><li>Title Case only. Never break “Amari Method” across lines.</li><li>No standalone symbol, rings, or improvised icon.</li><li>On dark fields, use the approved reversed asset treatment.</li></ul></div>
    </section>
    <section className="amari-design-system__do-dont"><div><strong>Use</strong><p>Ink, warm paper, large type, genuine session photography, and purposeful empty space.</p></div><div><strong>Do not use</strong><p>Blue-green, medical green, gold, gradients, glowing effects, decorative icons, rounded wellness cards, or a black bar over a person.</p></div></section>
  </>;
}

const screenRows = [
  ['Display', '56–72 px', '42–50 px', '0.96–1.02', 'One main statement. Never below 42 px on mobile.'],
  ['Section heading', '34–40 px', '28–32 px', '1.08–1.15', 'Use for section-level statements.'],
  ['Subheading', '20–24 px', '19–22 px', '1.18–1.25', 'Direct and informational.'],
  ['Lead', '20–22 px', '18–20 px', '1.35–1.45', 'A page introduction, not a second headline.'],
  ['Body', '16–18 px', '16–17 px', '1.50–1.60', 'Minimum for reading copy: 16 px.'],
  ['Action / navigation', '14–16 px', '14–16 px', '1.20–1.35', 'Minimum for a tappable public action: 14 px.'],
  ['Caption / utility', '12–14 px', '12–14 px', '1.30–1.45', '12 px is the floor; never use it for core information.'],
];

const printRows = [
  ['Business card', 'Name 10 pt · promise 11.5 pt', 'Website 8.5 pt · email/phone 8 pt', '7 pt city line only', 'No QR. Do not take space from contact details.'],
  ['4 × 6 postcard', 'Front promise 22 pt · label 14.5 pt', 'Pain/restriction 13 pt · CTA 13.5 pt · URL 9 pt', '7 pt location', '0.85 in QR; no explanatory paragraph.'],
  ['8.5 × 11 flyer', 'Promise 46 pt · service 21 pt', 'Pain/restriction 15 pt · CTA 19 pt · URL 11 pt', '8 pt location', '1 in QR; promise leads from distance.'],
];

function TypeStandards() {
  return <>
    <SectionHeader index="02 / TYPE STANDARDS" title="Size is a legibility decision." body="These sizes are the approved baseline, not a starting point for squeezing more content into a layout." />
    <section className="amari-design-system__type-intro"><div><Type aria-hidden="true" /><h3>Two voices. Clear jobs.</h3></div><dl><div><dt>Wordmark</dt><dd><strong>Gothia Serif SemiBold</strong><span>Amari Method identity asset only.</span></dd></div><div><dt>Supporting type</dt><dd><strong>ABC Diatype Regular / Medium</strong><span>All messaging, labels, URLs, and information.</span></dd></div></dl></section>
    <section className="amari-design-system__minimum-callout"><p>Non-negotiable minimums</p><strong>16 px body on screen.<br />14 px for a public action.<br />8 pt for essential print contact copy.</strong><span>7 pt is allowed only for a secondary location line on the approved card or postcard. It is never a phone number, email, URL, or call to action.</span></section>
    <section className="amari-design-system__table-section"><h3>Screen scale</h3><div className="amari-design-system__table-wrap"><table><thead><tr><th>Role</th><th>Desktop</th><th>Mobile</th><th>Line height</th><th>Rule</th></tr></thead><tbody>{screenRows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div></section>
    <section className="amari-design-system__type-rules"><article><strong>Tracking</strong><p>Do not make words look “premium” by scrunching them. ABC Diatype display copy may tighten to <code>-0.04em</code>; utility caps may open to <code>0.08em</code>. No other tracking is a default.</p></article><article><strong>Line breaks</strong><p>Break by phrase, not by a narrow column. Preserve “the way” as a unit; do not make accidental word staircases.</p></article><article><strong>Weight</strong><p>Regular carries explanation. Medium carries headings, labels, contact information, and calls to action. Do not use italics as decoration.</p></article></section>
    <section className="amari-design-system__table-section"><h3>Print scale and floors</h3><div className="amari-design-system__print-table">{printRows.map(([surface, primary, contact, floor, note]) => <article key={surface}><h4>{surface}</h4><dl><div><dt>Primary</dt><dd>{primary}</dd></div><div><dt>Contact / action</dt><dd>{contact}</dd></div><div><dt>Absolute floor</dt><dd>{floor}</dd></div></dl><p>{note}</p></article>)}</div></section>
  </>;
}

function CopySystem() {
  return <>
    <SectionHeader index="03 / COPY SYSTEM" title="Promise first. Then meaning. Then action." body="Use only the layers that the particular surface needs. The goal is clarity, not writing a smaller website." />
    <section className="amari-design-system__copy-sequence">{[['01', 'Promise', 'Subtle input.\nUnmistakable result.'], ['02', 'What it is', 'Private, hands-on\nguided movement'], ['03', 'Who / why', 'For pain and restriction that get in the way of\nwork, training, and life.'], ['04', 'Action', 'Explore Amari\namarimethod.com']].map(([number, label, copy]) => <article key={number}><span>{number}</span><p>{label}</p><strong>{copy.split('\n').map((line) => <>{line}<br /></>)}</strong></article>)}</section>
    <section className="amari-design-system__language-grid"><article><h3>Use</h3><ul><li>Private, hands-on guided movement</li><li>Work, training, and life</li><li>Move, breathe, find the place your body lets go</li><li>Strong, concrete language calibrated to actual practice</li></ul></article><article><h3>Never reduce it to</h3><ul><li>Generic mobility, a workout, yoga, passive treatment, or posture coaching</li><li>A virtual offering or medical-tech solution</li><li>Quantified, diagnostic, comparative, or guarantee language</li><li>Wellness-spa shorthand</li></ul></article></section>
  </>;
}

function Photography() {
  return <>
    <SectionHeader index="04 / PHOTOGRAPHY" title="Show the actual practice." body="A photograph should establish active, person-to-person guidance—not generic exertion or passive treatment." />
    <section className="amari-design-system__photo-feature"><figure><img src="/images/photos/amari-method-guided-forearm-position-athletic-client.png" alt="Garrett guiding a client’s forearm position" /><figcaption>Preferred collateral image · direct guidance, real session</figcaption></figure><div><p>Preferred use</p><h3>Garrett guiding a client’s forearm.</h3><span>It makes the private, hands-on relationship immediately clear. Use this first when a piece must explain Amari to someone new.</span><ul><li>Place type on the quiet side of the image.</li><li>Protect the face, hands, and point of contact.</li><li>A soft directional darkening is acceptable only for legibility.</li></ul></div></section>
    <section className="amari-design-system__photo-grid"><figure><img src="/images/photos/amari-method-guided-jaw-position-athletic-client.png" alt="Guided jaw position in an Amari session" /><figcaption>Hands-on detail</figcaption></figure><figure><img src="/images/photos/amari-method-power-posture-athletic-client.png" alt="Client in an Amari movement session" /><figcaption>Movement in context</figcaption></figure><article><h3>Do not use</h3><p>Staged smiles, treatment-table passivity, stock-fitness poses, spa imagery, anatomy graphics, AI outcome imagery, before/after claims, or a solid black bar over a subject.</p></article></section>
  </>;
}

function PrintStandards() {
  return <>
    <SectionHeader index="05 / PRINT STANDARDS" title="One family. Three jobs." body="Every piece shares the same materials and hierarchy, but none should feel like a scaled version of another." />
    <section className="amari-design-system__production-band"><strong>All pieces: 0.125 in bleed · 0.25 in live area · ink + warm paper · uncoated substantial stock</strong><span>Use only an approved high-resolution original for final production. Browser proofs are composition references, not press-ready photography.</span></section>
    <section className="amari-design-system__print-specs"><article className="amari-design-system__print-card"><p>Business card</p><div><img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" /></div><h3>Identity and contact.</h3><span>3.5 × 2 in · landscape · double-sided</span><ul><li>Front: wordmark only, centered on ink.</li><li>Back: Garrett, promise, San Francisco, website, email, phone.</li><li>No QR. No tagline on the front.</li></ul><Link to="/design-system/type">See exact type sizes <ArrowUpRight aria-hidden="true" /></Link></article><article className="amari-design-system__print-postcard"><p>4 × 6 postcard</p><h3>Your body can change<br />in a moment.</h3><span>Landscape · double-sided</span><ul><li>Front: image, wordmark, promise, location only.</li><li>Back: what it is, pain/restriction relevance, Explore Amari, QR, URL.</li><li>Do not add the flyer paragraph.</li></ul><Link to="/design-system/type">See exact type sizes <ArrowUpRight aria-hidden="true" /></Link></article><article className="amari-design-system__print-flyer"><p>8.5 × 11 flyer</p><h3>Subtle input.<br />Unmistakable result.</h3><span>Portrait · one-sided</span><ul><li>Promise reads from a distance.</li><li>Then literal service, relevance, action.</li><li>QR is 1 in and goes to amarimethod.com.</li></ul><Link to="/design-system/type">See exact type sizes <ArrowUpRight aria-hidden="true" /></Link></article></section>
  </>;
}

function Decisions() {
  const decisions = [
    ['2026-08-09', 'Type floors are locked', 'Screen body is never below 16 px; a public action is never below 14 px; essential print contact copy is never below 8 pt. The 7 pt exception is a secondary location line only.'],
    ['2026-08-09', 'Print scale is surface-specific', 'The business card, 4 × 6 postcard, and Letter flyer have distinct approved size matrices. Never scale one layout down to make another.'],
    ['2026-08-09', 'Black and warm paper are the print palette', 'Do not use Tracksmith navy, blue-green, medical green, gradients, or a new accent system for Amari collateral.'],
    ['2026-08-09', 'The mark is fixed', 'Gothia Serif SemiBold is the Amari Method wordmark asset only; ABC Diatype is the supporting typeface for all other copy.'],
    ['2026-08-09', 'Current identity is the production source', 'In the Media Library, Current identity holds the approved wordmark and live favicon files. Historical logo files preserve prior variants and are not for new work.'],
    ['2026-08-09', 'Photography must show guidance', 'The Garrett/client forearm image is the preferred collateral image. Do not place a black bar over a face or the point of contact.'],
    ['2026-08-09', 'The three-piece family has distinct jobs', 'Business card: identity/contact. Postcard: intrigue then clarity. Flyer: immediate understanding for a stranger.'],
  ];
  return <>
    <SectionHeader index="06 / DECISION RECORD" title="When we decide it, it lives here." body="This is the living record for approved visual and production choices. Add a dated entry when a decision changes—not another untracked exception." />
    <section className="amari-design-system__decision-intro"><MoveUpRight aria-hidden="true" /><p>The detailed source of truth is maintained with the project at <code>amari/website/DESIGN-SYSTEM-2026-08.md</code>. This Staff page is the working reference for the team.</p></section>
    <section className="amari-design-system__decisions">{decisions.map(([date, title, body]) => <article key={title}><time>{date}</time><div><h3>{title}</h3><p>{body}</p></div><Check aria-hidden="true" /></article>)}</section>
  </>;
}

function PageContent({ section }: { section: SectionKey }) {
  if (section === 'foundations') return <Foundation />;
  if (section === 'type') return <TypeStandards />;
  if (section === 'copy') return <CopySystem />;
  if (section === 'photography') return <Photography />;
  if (section === 'print') return <PrintStandards />;
  if (section === 'decisions') return <Decisions />;
  return <Overview />;
}

export default function DesignSystemPage() {
  const { pathname } = useLocation();
  const active = resolveSection(pathname);
  const activeSection = sections.find((section) => section.key === active)!;
  return <main className="amari-design-system">
    <aside className="amari-design-system__rail"><Link className="amari-design-system__rail-mark" to="/design-system"><img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" /></Link><nav aria-label="Design system sections">{sections.map((section, index) => <Link key={section.key} to={section.path} className={section.key === active ? 'is-active' : ''}><span>0{index + 1}</span><strong>{section.label}</strong><small>{section.detail}</small></Link>)}</nav><Link className="amari-design-system__media-link" to="/media"><Images aria-hidden="true" /> Media library <ArrowUpRight aria-hidden="true" /></Link></aside>
    <div className="amari-design-system__content"><div className="amari-design-system__page-kicker"><span>Amari Method / internal reference</span><b>{activeSection.label}</b></div><PageContent section={active} /></div>
  </main>;
}
