import { ArrowUpRight, Images, Palette, Type } from 'lucide-react';
import { Link } from 'react-router-dom';
import './DesignSystemPage.css';

const principles = [
  ['Grounded', 'Real bodies, real settings, exact language.'],
  ['Editorial', 'One strong thought at a time; room for it to land.'],
  ['Capable', 'Private, hands-on, and precise — never spa-like or clinical.'],
];

const typeRows = [
  ['Wordmark', 'Gothia Serif SemiBold', 'Identity only'],
  ['Supporting type', 'ABC Diatype', 'Every other line of copy'],
  ['Utility line', 'ABC Diatype Medium', 'Uppercase with measured tracking'],
];

export default function DesignSystemPage() {
  return (
    <main className="amari-design-system">
      <section className="amari-design-system__hero">
        <div className="amari-design-system__intro">
          <p className="amari-design-system__eyebrow">Amari Method · internal reference</p>
          <h1>Design<br />system.</h1>
          <p className="amari-design-system__lede">The shared visual and verbal system for every public-facing Amari surface.</p>
        </div>
        <div className="amari-design-system__promise" aria-label="Amari Method creative anchor">
          <img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" />
          <p>Subtle input.<br />Unmistakable result.</p>
          <span>San Francisco</span>
        </div>
      </section>

      <section className="amari-design-system__section amari-design-system__section--principles" aria-labelledby="principles-heading">
        <header>
          <p className="amari-design-system__label">01 / Foundation</p>
          <h2 id="principles-heading">The feeling to protect.</h2>
        </header>
        <div className="amari-design-system__principles">
          {principles.map(([title, detail], index) => <article key={title}>
            <span>0{index + 1}</span><h3>{title}</h3><p>{detail}</p>
          </article>)}
        </div>
      </section>

      <section className="amari-design-system__section amari-design-system__foundation" aria-label="Color and typography">
        <div className="amari-design-system__color-block">
          <div className="amari-design-system__color-swatch amari-design-system__color-swatch--ink"><span>Ink</span><strong>#171A18</strong></div>
          <div className="amari-design-system__color-swatch amari-design-system__color-swatch--paper"><span>Warm paper</span><strong>#F4F3EE</strong></div>
        </div>
        <div className="amari-design-system__type-block">
          <div className="amari-design-system__section-intro"><Type aria-hidden="true" /><div><p className="amari-design-system__label">02 / Type</p><h2>Two voices. Clear jobs.</h2></div></div>
          <dl>
            {typeRows.map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd><strong>{value}</strong><span>{note}</span></dd></div>)}
          </dl>
        </div>
      </section>

      <section className="amari-design-system__section amari-design-system__hierarchy" aria-labelledby="hierarchy-heading">
        <div className="amari-design-system__section-intro"><Palette aria-hidden="true" /><div><p className="amari-design-system__label">03 / Copy hierarchy</p><h2 id="hierarchy-heading">Promise first. Then meaning. Then action.</h2></div></div>
        <div className="amari-design-system__copy-example">
          <p className="amari-design-system__utility">Private, hands-on guided movement</p>
          <p className="amari-design-system__headline">Subtle input.<br />Unmistakable result.</p>
          <p className="amari-design-system__support">For pain and restriction that get in the way of <strong>work, training, and life.</strong></p>
          <p className="amari-design-system__cta">Explore Amari <ArrowUpRight aria-hidden="true" /></p>
        </div>
      </section>

      <section className="amari-design-system__section amari-design-system__photography" aria-labelledby="photography-heading">
        <header>
          <p className="amari-design-system__label">04 / Photography</p>
          <h2 id="photography-heading">Show the actual practice.</h2>
          <p>Choose quiet, real session imagery that makes the guiding relationship clear. Protect faces and the point of contact; never cover either with a black bar.</p>
        </header>
        <div className="amari-design-system__photo-grid">
          <figure className="amari-design-system__photo amari-design-system__photo--featured"><img src="/images/photos/amari-method-guided-forearm-position-athletic-client.png" alt="Garrett guiding a client’s forearm position" /><figcaption>Preferred collateral image · direct guidance, real session</figcaption></figure>
          <figure className="amari-design-system__photo"><img src="/images/photos/amari-method-guided-jaw-position-athletic-client.png" alt="Guided jaw position in an Amari session" /><figcaption>Hands-on detail</figcaption></figure>
          <figure className="amari-design-system__photo"><img src="/images/photos/amari-method-power-posture-athletic-client.png" alt="Client in an Amari movement session" /><figcaption>Movement in context</figcaption></figure>
        </div>
      </section>

      <section className="amari-design-system__section amari-design-system__applications" aria-labelledby="applications-heading">
        <header><p className="amari-design-system__label">05 / Print system</p><h2 id="applications-heading">One family, three jobs.</h2></header>
        <div className="amari-design-system__applications-grid">
          <article className="amari-design-system__application amari-design-system__application--card"><small>Business card</small><img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" /><p>Identity and contact. Quiet, premium, highly legible.</p></article>
          <article className="amari-design-system__application amari-design-system__application--postcard"><small>4 × 6 postcard</small><strong>Your body can change<br />in a moment.</strong><p>Create intrigue, then make the offering clear.</p></article>
          <article className="amari-design-system__application amari-design-system__application--flyer"><small>8.5 × 11 flyer</small><strong>Subtle input.<br />Unmistakable result.</strong><p>Make a stranger understand immediately that this could be for them.</p></article>
        </div>
      </section>

      <section className="amari-design-system__library-callout">
        <div><Images aria-hidden="true" /><p className="amari-design-system__label">Shared source files</p><h2>Use the approved assets.</h2><p>The Media Library holds the current wordmark, logos, and all public site imagery in one private place.</p></div>
        <Link to="/media">Open Media Library <ArrowUpRight aria-hidden="true" /></Link>
      </section>
    </main>
  );
}
