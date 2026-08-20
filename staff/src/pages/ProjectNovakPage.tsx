import { ArrowRight, FileText, Goal, Trophy } from 'lucide-react';
import './ProjectNovakPage.css';

const PATHS = [
  {
    number: '01',
    eyebrow: 'Build the company',
    title: 'Premium care people choose again.',
    text: 'Serve demanding bodies exceptionally. Build a business with real return care, clear premium decisions, and a reputation that travels through people.',
  },
  {
    number: '02',
    eyebrow: 'Enter the conversation',
    title: 'Earn serious tennis relationships.',
    text: 'Show up repeatedly in the right rooms. Let coaches, performance people, and body professionals experience or closely observe what Garrett does.',
  },
  {
    number: '03',
    eyebrow: 'Reach the team',
    title: 'Make the warm introduction inevitable.',
    text: 'Build a chain of trusted people who know the work well enough to introduce Garrett one meaningful step closer to Djokovic’s performance circle.',
  },
];

const HORIZONS = [
  {
    label: 'Now → 90 days',
    title: 'Choose the rooms.',
    text: 'Select one premium body-professional host and one tennis or racquet-sport host. Run a small founder cohort, learn from every experience, and name the first credible connection hypothesis.',
  },
  {
    label: 'Year one',
    title: 'Build proof and a bridge.',
    text: 'Establish the commercial wedge, a base of demanding-body clients, and trusted tennis/performance people who can accurately describe the work and open the next conversation.',
  },
  {
    label: 'Years two + three',
    title: 'Make the attempt.',
    text: 'Earn the professional-performance bridge, build destination-care readiness from real demand, and make a respectful warm invitation when the right route exists.',
  },
];

const FILTERS = [
  ['Care reputation', 'Does this create a deeper, real experience of Amari for a demanding body?'],
  ['Commercial strength', 'Does this create paid care, trusted demand, or delivery capacity?'],
  ['Tennis access', 'Does this bring us one credible relationship closer to Djokovic’s performance circle?'],
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
        <span>Build the company, earn the performance relationships, make the introduction.</span>
      </div>
      <figure className="project-novak__hero-image">
        <img src={IMAGES[0].src} alt={IMAGES[0].alt} />
        <figcaption><a href={IMAGES[0].href} target="_blank" rel="noreferrer">{IMAGES[0].credit}</a></figcaption>
      </figure>
    </header>

    <section className="project-novak__target" aria-labelledby="novak-target">
      <Goal aria-hidden="true" />
      <div>
        <p>What we are building</p>
        <h2 id="novak-target">A serious San Francisco care company with a real route into Djokovic’s performance circle.</h2>
        <a className="project-novak__plan-link" href="/staff/resources/project-novak-plan.txt" target="_blank" rel="noreferrer"><FileText aria-hidden="true" /> Read the full internal plan <ArrowRight aria-hidden="true" /></a>
      </div>
    </section>

    <section className="project-novak__section project-novak__section--path" aria-labelledby="novak-path">
      <header><p>The path</p><h2 id="novak-path">Three moves. One direction.</h2></header>
      <div className="project-novak__path-grid">
        {PATHS.map((path) => <article key={path.number}>
          <span>{path.number}</span>
          <p>{path.eyebrow}</p>
          <h3>{path.title}</h3>
          <div>{path.text}</div>
        </article>)}
      </div>
    </section>

    <section className="project-novak__route" aria-label="Project Novak route">
      <span>Exceptional care</span><ArrowRight aria-hidden="true" /><span>Trusted tennis people</span><ArrowRight aria-hidden="true" /><span>Performance connector</span><ArrowRight aria-hidden="true" /><strong>Novak’s team</strong>
    </section>

    <section className="project-novak__section" aria-labelledby="novak-horizons">
      <header><p>The horizons</p><h2 id="novak-horizons">Own the next move.</h2></header>
      <ol className="project-novak__timeline">
        {HORIZONS.map((horizon, index) => <li key={horizon.label}>
          <span className="project-novak__marker">{String(index + 1).padStart(2, '0')}</span>
          <div><p>{horizon.label}</p><h3>{horizon.title}</h3><span>{horizon.text}</span></div>
        </li>)}
      </ol>
    </section>

    <section className="project-novak__section project-novak__section--filter" aria-labelledby="novak-filter">
      <header><p>Operating filter</p><h2 id="novak-filter">Every move earns its place.</h2></header>
      <div className="project-novak__filter-grid">
        {FILTERS.map(([title, text]) => <article key={title}><h3>{title}</h3><span>{text}</span></article>)}
      </div>
      <p className="project-novak__filter-note">At the monthly Project Novak review, Eben and Garrett choose the next move from the evidence: deepen, redirect, or stop.</p>
    </section>

    <section className="project-novak__owners" aria-label="Project Novak ownership">
      <div><p>Owner · Eben</p><h3>Route, economics, and evidence.</h3></div>
      <div><p>Owner · Garrett</p><h3>Care, presence, and trust.</h3></div>
      <div><p>Shared</p><h3>One monthly keep / change decision.</h3></div>
    </section>

    <section className="project-novak__gallery" aria-label="Novak Djokovic reference imagery">
      {IMAGES.slice(1).map((image) => <figure key={image.src}><img src={image.src} alt={image.alt} /><figcaption><a href={image.href} target="_blank" rel="noreferrer">{image.credit} <ArrowRight aria-hidden="true" /></a></figcaption></figure>)}
    </section>
  </main>;
}
