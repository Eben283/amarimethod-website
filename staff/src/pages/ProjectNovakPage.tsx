import { ArrowRight, Goal, Trophy } from 'lucide-react';
import './ProjectNovakPage.css';

const MILESTONES = [
  { horizon: '3 months', date: 'November 2026', title: 'Establish the beachhead', text: 'Tennis-center activity produces real Assessments. Three to five tennis-connected partners have experienced the work, and we know which invitation earns a booking.' },
  { horizon: '6 months', date: 'February 2027', title: 'Prove repeatability', text: 'The strongest partner paths create a steady flow of tennis-player Assessments and Practices. Two or three consented stories accurately show why the work matters.' },
  { horizon: '12 months', date: 'August 2027', title: 'Earn the category', text: 'Amari is known by the right Bay Area tennis coaches, shops, recovery businesses, and serious players. The tennis experience has a repeatable quarterly rhythm.' },
  { horizon: '24 months', date: 'August 2028', title: 'Let the reputation travel', text: 'Relationships extend through California tennis and performance networks. A practitioner dossier and proof library make a trusted introduction easy to make.' },
  { horizon: '36 months', date: 'August 2029', title: 'Be introduced through trust', text: 'Amari is credible enough to enter a top-tier player’s trusted network. The aim is a legitimate introduction, not a cold pitch to Novak.' },
];

const NEXT_YEAR = [
  ['Months 1–3', 'Make the Golden Gate Park Tennis Center table convert', 'One clear invitation, one booking path, and a same-day follow-up owner. Activate City Racquet, Vital Ice, and selected tennis pros with a concrete next step.'],
  ['Months 4–6', 'Choose the referral paths that create Practices', 'Run one small tennis-specific experience and publish only genuine, consented evidence from the people served.'],
  ['Months 7–12', 'Become a recognizable tennis resource', 'Maintain partner outreach, a quarterly field experience, and disciplined relationship follow-up. Build the concise Amari-for-high-use-bodies practitioner brief.'],
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
        <p><Trophy aria-hidden="true" /> Internal strategy</p>
        <h1>Project Novak</h1>
        <strong>North Star: Novak Djokovic is under Amari’s care.</strong>
        <span>Build the kind of trusted tennis reputation that makes the right introduction natural.</span>
      </div>
      <figure className="project-novak__hero-image">
        <img src={IMAGES[0].src} alt={IMAGES[0].alt} />
        <figcaption><a href={IMAGES[0].href} target="_blank" rel="noreferrer">{IMAGES[0].credit}</a></figcaption>
      </figure>
    </header>

    <section className="project-novak__north-star">
      <Goal aria-hidden="true" />
      <div><p>The route</p><h2>Trusted access → undeniable proof → referred care relationships</h2></div>
      <span>Every action should move at least one of these. Awareness alone is not the project.</span>
    </section>

    <section className="project-novak__section" aria-labelledby="novak-ramp">
      <header><p>Three-year ramp</p><h2 id="novak-ramp">Earn the right to the introduction.</h2></header>
      <ol className="project-novak__timeline">
        {MILESTONES.map((milestone, index) => <li key={milestone.horizon}>
          <span className="project-novak__marker">{String(index + 1).padStart(2, '0')}</span>
          <div><p>{milestone.horizon} <small>{milestone.date}</small></p><h3>{milestone.title}</h3><span>{milestone.text}</span></div>
        </li>)}
      </ol>
    </section>

    <section className="project-novak__section project-novak__section--year" aria-labelledby="novak-year">
      <header><p>First 12 months</p><h2 id="novak-year">Build the local proof ground.</h2></header>
      <div className="project-novak__year-grid">
        {NEXT_YEAR.map(([period, title, text]) => <article key={period}><p>{period}</p><h3>{title}</h3><span>{text}</span></article>)}
      </div>
    </section>

    <section className="project-novak__gallery" aria-label="Novak Djokovic reference imagery">
      {IMAGES.slice(1).map((image) => <figure key={image.src}><img src={image.src} alt={image.alt} /><figcaption><a href={image.href} target="_blank" rel="noreferrer">{image.credit} <ArrowRight aria-hidden="true" /></a></figcaption></figure>)}
    </section>
  </main>;
}
