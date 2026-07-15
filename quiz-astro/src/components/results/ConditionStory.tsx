// Pain-location-specific story for the results page (premium mockup restyle).
//
// Renders three editorial sections sequentially:
//   1. "Why your X keeps hurting" — why-cards sourced from whyCards
//   2. "A taste of the work" — protocolIntro video block
//   3. "Where X pain actually comes from" — chain steps
//
// Falls back to a generic chain for pain locations without a condition page
// (upper back, ankles/feet, wrists/hands, elbows). All copy is sourced from
// `lib/conditionContent.ts` — never hardcoded per-location here.

import React from 'react';
import { ConditionContent } from '@/lib/conditionContent';

type Props = {
  content: ConditionContent;
};

/**
 * Splits a heading and wraps the final emphasis phrase in <em>.
 * Tries known suffixes first ("keeps hurting", "keeps coming back",
 * "comes from", "actually comes from"), falls back to the last two words.
 */
function renderItalicTail(heading: string): React.ReactNode {
  const suffixes = [
    'actually comes from',
    'keeps coming back',
    'keeps hurting',
    'comes from',
  ];
  for (const suffix of suffixes) {
    if (heading.toLowerCase().endsWith(suffix)) {
      const head = heading.slice(0, heading.length - suffix.length);
      const tail = heading.slice(heading.length - suffix.length);
      return (
        <>
          {head}<em>{tail}.</em>
        </>
      );
    }
  }
  const parts = heading.split(' ');
  if (parts.length < 3) return <em>{heading}.</em>;
  const head = parts.slice(0, -2).join(' ') + ' ';
  const tail = parts.slice(-2).join(' ');
  return (
    <>
      {head}<em>{tail}.</em>
    </>
  );
}

/**
 * Renders a protocol name with the noun phrase italicized.
 * "The Spinal Wave"   → The <em>Spinal Wave.</em>
 * "Power Posture"     → <em>Power Posture.</em>
 * "The Hand Balancer" → The <em>Hand Balancer.</em>
 */
function renderProtocolName(name: string): React.ReactNode {
  if (name.toLowerCase().startsWith('the ')) {
    return (
      <>
        The <em>{name.slice(4)}.</em>
      </>
    );
  }
  return <em>{name}.</em>;
}

const ConditionStory = ({ content }: Props) => {
  const protocolDurationLabel = content.protocolIntro?.durationLabel?.toUpperCase() ?? '';

  return (
    <>
      {/* ─── WHY YOUR X KEEPS HURTING ─── */}
      <section className="doc sect">
        <div className="section-head" style={{ borderTop: 'none', marginTop: 0, paddingTop: 48 }}>
          <span className="eyebrow">Why it keeps hurting</span>
          <h2>{renderItalicTail(content.whyHeading)}</h2>
          <p className="lede">{content.whySubline}</p>
        </div>

        <div className="why-cards">
          {content.whyCards.map((card) => (
            <div key={card.num} className="why-card">
              <span className="n">{card.num}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── PROTOCOL INTRO VIDEO ─── */}
      {content.protocolIntro ? (
        <section className="doc sect">
          <div className="section-head" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
            <span className="eyebrow">A taste of the work</span>
            <h2>{renderProtocolName(content.protocolIntro.name)}</h2>
          </div>

          <div className="video-block">
            <p className="pull">{content.protocolIntro.framingLine}</p>

            <div className="video-frame-outer">
              <span className="corner-bl" aria-hidden="true" />
              <span className="corner-br" aria-hidden="true" />
              <div className="video-frame-inner">
                <video
                  src={content.protocolIntro.introVideoUrl}
                  controls
                  preload="metadata"
                  playsInline
                />
              </div>
            </div>

            <div className="video-cap">
              <span>{protocolDurationLabel} · Garrett introducing the protocol</span>
              <span>Fig. {content.protocolIntro.name}</span>
            </div>

            <p className="video-note">
              The actual hands-on guidance lives in your first session, where Garrett adapts the protocol to your specific body.
            </p>
          </div>
        </section>
      ) : null}

      {/* ─── WHERE PAIN ACTUALLY COMES FROM ─── */}
      <section className="doc sect">
        <div className="section-head" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
          <span className="eyebrow">The pattern</span>
          <h2>{renderItalicTail(content.chainHeading)}</h2>
          <p className="lede">{content.chainSubline}</p>
        </div>

        <div className="chain">
          {content.chainSteps.map((step) => (
            <div key={step.num} className="chain-step">
              <div className="lead">
                <span className="n">{step.num}</span>
                <div className="flow">{step.flow}</div>
              </div>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </div>
          ))}
        </div>

        {content.conditionPageSlug ? (
          <p className="chain-foot">
            Want the full breakdown?{' '}
            <a href={`https://www.amarimethod.com/${content.conditionPageSlug}`}>
              Read the full {content.displayName.toLowerCase()} page →
            </a>
          </p>
        ) : null}
      </section>
    </>
  );
};

export default ConditionStory;
