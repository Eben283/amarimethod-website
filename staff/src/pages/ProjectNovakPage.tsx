import { ArrowRight, FileText, Goal, Trophy } from 'lucide-react';
import './ProjectNovakPage.css';

const PLAN = [
  {
    number: '01',
    eyebrow: 'First 90 days',
    title: 'Choose two real starting points.',
    text: 'Pick one body-professional host and one tennis or racquet-sport host. Agree on why Amari belongs there, how people first experience it, and when we review what happened.',
  },
  {
    number: '02',
    eyebrow: 'First 90 days',
    title: 'Run the small cohort and learn.',
    text: 'Garrett delivers the work. Eben records the source, return care, paid-care choices, voluntary introductions, and any real next connection. Review the two lanes at days 30, 60, and 90.',
  },
  {
    number: '03',
    eyebrow: 'Months 4–12',
    title: 'Keep the lane that proves itself.',
    text: 'Concentrate on the lane that creates paid care and voluntary introductions. By year end, earn one trusted tennis or performance connector and name the next credible link toward Djokovic’s team.',
  },
];

const HORIZONS = [
  {
    label: 'Year two',
    title: 'Earn a serious performance bridge.',
    text: 'Use the business and trusted connectors to earn repeat care and discreet word-of-mouth with more demanding, better-connected people. The goal is one genuine bridge into professional tennis or a closely adjacent performance network.',
  },
  {
    label: 'Year three',
    title: 'Make the warm introduction.',
    text: 'When there is a credible route, make a small, respectful invitation to the person who can evaluate fit for Novak’s team. If the route is not real yet, identify the missing link and decide whether another three years is warranted.',
  },
];

const FILTERS = [
  ['Double down', 'The lane creates paid care and either voluntary introductions or a real tennis/performance bridge.'],
  ['Keep or repair', 'Keep a revenue-producing lane as business-only. Repair the experience or explanation when people value it but do not return.'],
  ['Exit', 'After two 90-day cycles with neither paid care nor a warm next step, stop calling it Project Novak work.'],
];

const IMAGES = [
  { src: '/staff/project-novak/novak-roland-garros-2024.jpg', alt: 'Novak Djokovic playing a backhand at the 2024 French Open', credit: 'Kuberzog · CC BY 4.0', href: 'https://commons.wikimedia.org/wiki/File:Novak_Djokovic_-_Roland-Garros_-_28.05.2024_croped.jpg' },
  { src: '/staff/project-novak/novak-eastbourne-2017.jpg', alt: 'Novak Djokovic at Eastbourne in 2017', credit: 'Andrew Campbell · CC BY 2.0', href: 'https://commons.wikimedia.org/wiki/File:Novak_Djokovic_(34775891004).jpg' },
  { src: '/staff/project-novak/novak-us-open-2006.jpg', alt: 'Novak Djokovic at the 2006 US Open', credit: 'Alexisrael · Public domain', href: 'https://commons.wikimedia.org/wiki/File:Novak_Djokovic_US_Open_2006.jpg' },
];

export default function ProjectNovakPage() {
  return <main className="project-novak">
    <header className="project-novak__hero">
      <div className="project-novak__hero-copy">
        <p><Trophy aria-hidden="true" /> Internal target · August 2029</p>
        <h1>Project<br />Novak</h1>
        <strong>Bring Novak Djokovic under Garrett’s care.</strong>
        <span>A three-year plan: build proof, earn the right relationships, then make a credible introduction.</span>
      </div>
      <figure className="project-novak__hero-image">
        <img src={IMAGES[0].src} alt={IMAGES[0].alt} />
        <figcaption><a href={IMAGES[0].href} target="_blank" rel="noreferrer">{IMAGES[0].credit}</a></figcaption>
      </figure>
    </header>

    <section className="project-novak__target" aria-labelledby="novak-target">
      <Goal aria-hidden="true" />
      <div>
        <p>The goal by August 2029</p>
        <h2 id="novak-target">A warm, credible route for Novak Djokovic to experience Garrett’s care.</h2>
        <a className="project-novak__plan-link" href="/staff/resources/project-novak-plan.txt" target="_blank" rel="noreferrer"><FileText aria-hidden="true" /> Read the full internal plan <ArrowRight aria-hidden="true" /></a>
      </div>
    </section>

    <section className="project-novak__section project-novak__section--path" aria-labelledby="novak-path">
      <header><p>The plan outline</p><h2 id="novak-path">Start here. Prove it. Build the bridge.</h2></header>
      <div className="project-novak__path-grid">
        {PLAN.map((path) => <article key={path.number}>
          <span>{path.number}</span>
          <p>{path.eyebrow}</p>
          <h3>{path.title}</h3>
          <div>{path.text}</div>
        </article>)}
      </div>
    </section>

    <section className="project-novak__route" aria-label="Project Novak route">
      <span>Real care experience</span><ArrowRight aria-hidden="true" /><span>Trusted local introducers</span><ArrowRight aria-hidden="true" /><span>Professional-performance bridge</span><ArrowRight aria-hidden="true" /><strong>Novak’s team</strong>
    </section>

    <section className="project-novak__section" aria-labelledby="novak-horizons">
      <header><p>What happens after year one</p><h2 id="novak-horizons">Earn the bridge, then use it.</h2></header>
      <ol className="project-novak__timeline">
        {HORIZONS.map((horizon, index) => <li key={horizon.label}>
          <span className="project-novak__marker">{String(index + 1).padStart(2, '0')}</span>
          <div><p>{horizon.label}</p><h3>{horizon.title}</h3><span>{horizon.text}</span></div>
        </li>)}
      </ol>
    </section>

    <section className="project-novak__section project-novak__section--filter" aria-labelledby="novak-filter">
      <header><p>Decision rules</p><h2 id="novak-filter">At each review, decide what happens next.</h2></header>
      <div className="project-novak__filter-grid">
        {FILTERS.map(([title, text]) => <article key={title}><h3>{title}</h3><span>{text}</span></article>)}
      </div>
      <p className="project-novak__filter-note">Eben and Garrett hold a monthly review. The question is concrete: double down, keep it as business-only, repair it, or stop.</p>
    </section>

    <section className="project-novak__owners" aria-label="Project Novak ownership">
      <div><p>Eben owns</p><h3>Hosts, numbers, route, and review.</h3></div>
      <div><p>Garrett owns</p><h3>The care, relationships, and trust.</h3></div>
      <div><p>Together</p><h3>One clear decision every month.</h3></div>
    </section>

    <section className="project-novak__gallery" aria-label="Novak Djokovic reference imagery">
      {IMAGES.slice(1).map((image) => <figure key={image.src}><img src={image.src} alt={image.alt} /><figcaption><a href={image.href} target="_blank" rel="noreferrer">{image.credit} <ArrowRight aria-hidden="true" /></a></figcaption></figure>)}
    </section>
  </main>;
}
