import { ArrowRight, ExternalLink, FileText, Goal, Trophy } from 'lucide-react';
import './ProjectNovakPage.css';

const PLAN = [
  {
    number: '01',
    eyebrow: 'First 90 days',
    title: 'Choose two specific communities.',
    text: 'Choose one local fitness or movement community and one local tennis or racquet-sport community. In each, find a person or venue willing to invite a few people to try Amari, give honest feedback, and introduce anyone who is genuinely interested.',
  },
  {
    number: '02',
    eyebrow: 'First 90 days',
    title: 'Run a small test and learn.',
    text: 'Decide what the first session looks like and set a review date. Garrett delivers the work; Eben records who came, who returned, who chose paid care, and whether any genuine introductions followed. Review both communities at days 30, 60, and 90.',
  },
  {
    number: '03',
    eyebrow: 'Months 4–12',
    title: 'Keep doing what works.',
    text: 'Put more energy into the community where people return, pay for care, and introduce others. By the end of year one, know at least one person in tennis or performance sport who has seen the work and can make a useful next introduction.',
  },
];

const HORIZONS = [
  {
    label: 'Year two',
    title: 'Get closer to professional tennis.',
    text: 'Keep doing excellent work with people who are well connected in tennis or performance sport. The goal is to know one person who understands Amari and can introduce Garrett to someone closer to Novak’s team.',
  },
  {
    label: 'Year three',
    title: 'Ask for the introduction.',
    text: 'When someone who knows the work can introduce Garrett to the right person on Novak’s team, ask them to do it. Keep the invitation simple: would it be useful for Novak to try a session with Garrett? If nobody can make that introduction yet, identify who is missing from the chain.',
  },
];

const FILTERS = [
  ['Do more', 'Stay involved when people pay for care and introduce others, or when the community brings Garrett closer to tennis.'],
  ['Keep or fix', 'Keep a community that brings in revenue even if it does not help with Novak. Improve the session or explanation when people like it but do not return.'],
  ['Stop', 'After two 90-day periods with no paid care and no useful introductions, stop spending Project Novak time there.'],
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
        <span>Build a strong Amari practice. Meet people who know the work. Use the right introduction to get Novak a session.</span>
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
        <h2 id="novak-target">Novak Djokovic has a session with Garrett because someone who knows the work introduces it to his team.</h2>
        <div className="project-novak__plan-links">
          <a className="project-novak__plan-link" href="/staff/resources/project-novak-plan.txt" target="_blank" rel="noreferrer"><FileText aria-hidden="true" /> Read the full internal plan <ArrowRight aria-hidden="true" /></a>
          <a className="project-novak__roadmap-link" href="https://docs.google.com/document/d/1Bj9ZNh3bo9PC5qyijSx3sz1OySINT1dBpywi0U3Syts/edit" target="_blank" rel="noreferrer">Open the tennis target universe &amp; roadmap <ExternalLink aria-hidden="true" /></a>
        </div>
      </div>
    </section>

    <section className="project-novak__section project-novak__section--path" aria-labelledby="novak-path">
      <header><p>What we do first</p><h2 id="novak-path">Build local proof, then use it to meet the next person.</h2></header>
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
      <span>People try Amari</span><ArrowRight aria-hidden="true" /><span>They tell people they trust</span><ArrowRight aria-hidden="true" /><span>Someone closer to tennis sees the work</span><ArrowRight aria-hidden="true" /><strong>Novak’s team hears about it</strong>
    </section>

    <section className="project-novak__section" aria-labelledby="novak-horizons">
      <header><p>Years two and three</p><h2 id="novak-horizons">Keep meeting the next person until the right introduction exists.</h2></header>
      <ol className="project-novak__timeline">
        {HORIZONS.map((horizon, index) => <li key={horizon.label}>
          <span className="project-novak__marker">{String(index + 1).padStart(2, '0')}</span>
          <div><p>{horizon.label}</p><h3>{horizon.title}</h3><span>{horizon.text}</span></div>
        </li>)}
      </ol>
    </section>

    <section className="project-novak__section project-novak__section--filter" aria-labelledby="novak-filter">
      <header><p>How we decide</p><h2 id="novak-filter">Every month, decide whether to do more, fix it, or stop.</h2></header>
      <div className="project-novak__filter-grid">
        {FILTERS.map(([title, text]) => <article key={title}><h3>{title}</h3><span>{text}</span></article>)}
      </div>
      <p className="project-novak__filter-note">Eben and Garrett review the actual results every month. They decide whether to do more of it, keep it as regular business, fix what is not working, or stop.</p>
    </section>

    <section className="project-novak__owners" aria-label="Project Novak ownership">
      <div><p>Eben does</p><h3>Choose communities, track results, and run the monthly review.</h3></div>
      <div><p>Garrett does</p><h3>Deliver the sessions and build real relationships.</h3></div>
      <div><p>Together</p><h3>Choose the next step every month.</h3></div>
    </section>

    <section className="project-novak__gallery" aria-label="Novak Djokovic reference imagery">
      {IMAGES.slice(1).map((image) => <figure key={image.src}><img src={image.src} alt={image.alt} /><figcaption><a href={image.href} target="_blank" rel="noreferrer">{image.credit} <ArrowRight aria-hidden="true" /></a></figcaption></figure>)}
    </section>
  </main>;
}
