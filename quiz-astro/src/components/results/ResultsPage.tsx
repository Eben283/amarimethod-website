import React, { useRef } from 'react';
import { ScoreCategories, PatternSignature, QuizInsight } from '@/types/quiz';
import ResultsHero from './ResultsHero';
import ScoreCard from './ScoreCard';
import ScoreRadar from './ScoreRadar';
import InsightCards from './InsightCards';
import BookingCTA from './BookingCTA';
import ShareCard from './ShareCard';
import ConditionStory from './ConditionStory';
import { useShareResults } from '@/hooks/useShareResults';
import { useQuiz } from '@/contexts/QuizContext';
import { getConditionContent } from '@/lib/conditionContent';

type ResultsPageProps = {
  firstName: string;
  patternSignature: PatternSignature;
  scores: ScoreCategories;
  insights: QuizInsight[];
};

// ─── EDITORIAL DESIGN SYSTEM ─────────────────────────────────────────
// Jul 12 premium mockup tokens (cream/ink/Cormorant). Scoped under
// [data-results] so styles cannot bleed outside the React island.
const EDITORIAL_STYLES = `
[data-results] {
  --cream:#F8F1E8; --cream-2:#F1E7DA; --paper:#FCF7F1; --paper-2:#F1E7DA;
  --ink:#211D19; --ink-2:#5C554D; --body:#5C554D; --mute:#5C554D;
  --line:rgba(33,29,25,.14); --line-2:rgba(33,29,25,.32); --line-strong:rgba(33,29,25,.32);
  --accent:#A9481F; --rust:#A9481F; --forest:#3E4A32; --gold:#9C7A2E; --teal:#2E5C58;
  --display:"Cormorant Garamond",Georgia,serif;
  --sans:"General Sans",ui-sans-serif,system-ui,sans-serif;
  --mono:"General Sans",ui-sans-serif,system-ui,sans-serif;
  --ease:cubic-bezier(0.32,0.72,0,1);
  background:var(--cream); color:var(--ink); font-family:var(--sans);
  -webkit-font-smoothing:antialiased; font-size:16px; line-height:1.65;
  overflow-x:hidden;
}
[data-results] *{box-sizing:border-box}
[data-results] a{color:inherit;text-decoration:none}
[data-results] img,[data-results] video{display:block;max-width:100%}
[data-results] h1,[data-results] h2,[data-results] h3,[data-results] h4{
  font-family:var(--display);font-weight:500;letter-spacing:0;
  line-height:1.14;color:var(--ink);text-wrap:balance;margin:0;
}
[data-results] p{text-wrap:pretty;margin:0;color:var(--body)}
[data-results] em{font-style:italic;color:inherit}

[data-results] .doc{max-width:840px;margin:0 auto;padding:0 32px}
[data-results] .doc-narrow{max-width:840px;margin:0 auto;padding:0 32px}

[data-results] .mono{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--body);
}

[data-results] .eyebrow{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.2em;
  text-transform:uppercase;color:var(--rust);display:inline-flex;align-items:baseline;gap:6px;
}
[data-results] .eyebrow::before{content:none}

[data-results] .doc-bar{
  display:flex;align-items:center;justify-content:space-between;gap:14px;
  font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--body);padding:22px 32px;border-bottom:1px solid var(--line);flex-wrap:wrap;
  max-width:840px;margin:0 auto;background:transparent;
}
[data-results] .doc-bar-inner{
  width:100%;max-width:840px;margin:0 auto;
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:0;
}
[data-results] .doc-bar .brand{
  font-family:var(--display);font-size:18px;font-weight:500;letter-spacing:.2em;
  display:inline-flex;align-items:center;gap:10px;color:var(--ink);text-transform:uppercase;
}
[data-results] .doc-bar .brand .mark{display:none}
[data-results] .doc-bar .center{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--body);text-align:center;
}
[data-results] .doc-bar .right{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--body);
}
[data-results] .doc-bar .right a{border-bottom:1px solid var(--line-strong);padding-bottom:2px}
[data-results] .doc-bar .right a:hover{color:var(--ink);border-color:var(--ink)}

/* ── HERO ─────────────────────────────────────────────────────────── */
[data-results] .hero-finding{padding:44px 0 8px;text-align:left}
[data-results] .hero-stamp{
  display:inline-flex;align-items:center;gap:9px;
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.18em;
  text-transform:uppercase;color:var(--rust);
  border:1px solid rgba(169,72,31,.3);border-radius:2px;padding:7px 14px;margin-bottom:0;
}
[data-results] .hero-stamp .glyph{font-family:var(--display);font-size:16px;line-height:0;letter-spacing:0}
[data-results] .hero-headline{
  margin-top:24px;font-family:var(--display);font-weight:500;
  font-size:clamp(2.4rem,5.4vw,3.6rem);letter-spacing:0;line-height:1.08;
  max-width:18ch;margin-left:0;margin-right:0;margin-bottom:0;
}
[data-results] .hero-sub{
  margin-top:22px;font-family:var(--sans);font-style:normal;
  font-size:1.15rem;max-width:50ch;line-height:1.55;font-weight:400;color:var(--body);
}
[data-results] .hero-sub em{font-style:italic;color:var(--ink)}
[data-results] .hero-meta{
  margin-top:34px;display:grid;grid-template-columns:1fr 1fr;gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:3px;overflow:hidden;
  max-width:none;
}
[data-results] .hero-meta .cell{background:var(--paper);padding:20px 22px;text-align:left}
[data-results] .hero-meta .cell + .cell{border-left:none}
[data-results] .hero-meta .lbl{
  display:block;font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--body);margin-bottom:0;
}
[data-results] .hero-meta .val{
  display:block;margin-top:9px;font-family:var(--display);font-size:1.55rem;
  font-style:normal;font-weight:500;color:var(--ink);
}
[data-results] .hero-meta .val em{font-style:italic;color:var(--ink)}

/* ── SECTION HEAD ────────────────────────────────────────────────── */
[data-results] .section-head,[data-results] .sect{
  padding:48px 0 8px;border-top:1px solid var(--line);margin-top:48px;text-align:left;
}
[data-results] .section-head .eyebrow{margin-bottom:0;color:var(--rust)}
[data-results] .section-head h2,[data-results] .sect h2{
  margin-top:16px;font-family:var(--display);font-size:clamp(1.9rem,3.8vw,2.7rem);font-weight:500;
  letter-spacing:0;line-height:1.14;max-width:20ch;margin-left:0;margin-right:0;margin-bottom:0;
}
[data-results] .section-head .lede,[data-results] .sect .sub{
  margin-top:14px;font-family:var(--sans);font-style:normal;font-size:1.05rem;color:var(--body);
  max-width:54ch;margin-left:0;margin-right:0;line-height:1.55;
}

/* ── WHY CARDS (3-up) ────────────────────────────────────────────── */
[data-results] .why-cards,[data-results] .cred-grid{
  margin-top:30px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;
  border:none;margin-bottom:8px;
}
[data-results] .why-card,[data-results] .cred-cell{
  background:var(--paper);border:1px solid var(--line);border-radius:3px;padding:24px;
  display:flex;flex-direction:column;gap:0;
}
[data-results] .cred-cell + .cred-cell{border-left:1px solid var(--line)}
[data-results] .why-card .n,[data-results] .cred-cell .num{
  font-family:var(--display);font-size:1.4rem;color:var(--gold);font-weight:500;
  letter-spacing:0;text-transform:none;
}
[data-results] .why-card h3,[data-results] .cred-cell h3{
  margin-top:12px;font-family:var(--display);font-size:1.3rem;font-weight:500;line-height:1.2;color:var(--ink);
}
[data-results] .why-card p,[data-results] .cred-cell p{
  margin-top:12px;font-family:var(--sans);font-size:.95rem;line-height:1.55;color:var(--body);
}

/* ── PROTOCOL VIDEO BLOCK ────────────────────────────────────────── */
[data-results] .video-block{padding:26px 0 8px}
[data-results] .video-block .pull{
  font-family:var(--display);font-style:italic;font-size:1.15rem;
  color:var(--body);max-width:46ch;margin:0 0 20px;text-align:left;line-height:1.4;font-weight:400;
}
[data-results] .protocol{
  margin-top:26px;background:var(--forest);color:#fff;border-radius:3px;
  padding:34px clamp(26px,4vw,42px);display:flex;align-items:center;gap:26px;flex-wrap:wrap;
}
[data-results] .video-frame-outer{
  position:relative;max-width:100%;margin:0;padding:0;border:none;
}
[data-results] .video-frame-outer::before,
[data-results] .video-frame-outer::after,
[data-results] .video-frame-outer .corner-bl,
[data-results] .video-frame-outer .corner-br{display:none}
[data-results] .video-frame-inner{
  border:none;background:transparent;padding:0;border-radius:3px;overflow:hidden;
}
[data-results] .video-frame-inner video{
  width:100%;aspect-ratio:16/9;background:#000;display:block;border-radius:3px;
}
[data-results] .video-cap{
  display:flex;justify-content:space-between;align-items:baseline;
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--body);
  margin:14px 0 0;flex-wrap:wrap;gap:8px;
}
[data-results] .video-note{
  font-family:var(--sans);font-size:.95rem;color:var(--body);line-height:1.55;
  max-width:54ch;margin:18px 0 0;text-align:left;
}

/* ── CHAIN ────────────────────────────────────────────────────────── */
[data-results] .chain,[data-results] .chain-grid{
  margin-top:30px;display:flex;flex-direction:column;gap:0;
  border:none;
}
[data-results] .chain-grid{display:flex;flex-direction:column}
[data-results] .chain-grid.is-4{display:flex;flex-direction:column}
[data-results] .chain-step,[data-results] .chain-cell{
  display:grid;grid-template-columns:auto 1fr;gap:22px;padding:22px 0;
  border-top:1px solid var(--line);background:transparent;border-radius:0;
}
[data-results] .chain-step:first-child,[data-results] .chain-cell:first-child{border-top:none}
[data-results] .chain-cell + .chain-cell{border-left:none}
[data-results] .chain-step .lead{min-width:120px}
[data-results] .chain-step .n,[data-results] .chain-cell .num{
  font-family:var(--display);font-size:1.5rem;color:var(--gold);font-style:normal;font-weight:500;line-height:1;
}
[data-results] .chain-step .flow,[data-results] .chain-cell .flow{
  margin-top:6px;font-family:var(--sans);font-size:10.5px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--teal);
}
[data-results] .chain-step h3,[data-results] .chain-cell h3{
  font-family:var(--display);font-size:1.35rem;font-weight:500;line-height:1.2;color:var(--ink);
}
[data-results] .chain-step p,[data-results] .chain-cell p{
  margin-top:10px;font-family:var(--sans);font-size:.98rem;line-height:1.55;color:var(--body);
}
[data-results] .chain-foot{
  text-align:left;font-family:var(--sans);font-style:normal;
  font-size:.95rem;color:var(--body);padding:18px 0 8px;
}
[data-results] .chain-foot a{color:var(--ink);border-bottom:1px solid var(--line-strong)}
[data-results] .chain-foot a:hover{color:var(--rust);border-color:var(--rust)}

/* ── EXAMINER / NOTE ─────────────────────────────────────────────── */
[data-results] .examiner,[data-results] .note{
  margin-top:48px;border-top:1px solid var(--line);padding:40px 0 8px;border-bottom:none;
}
[data-results] .examiner-grid{
  display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:start;padding-left:0;
}
[data-results] .examiner-id{display:flex;flex-direction:column;gap:10px;padding-top:0}
@media (max-width:760px){
  [data-results] .examiner-grid{grid-template-columns:1fr;gap:20px}
}
[data-results] .examiner-avatar{
  width:48px;height:48px;border-radius:50%;background:var(--ink);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--display);color:#fff;font-size:22px;font-style:italic;font-weight:500;
}
[data-results] .examiner-id .who{
  font-family:var(--display);font-size:1.2rem;line-height:1.25;color:var(--ink);font-weight:500;
}
[data-results] .examiner-id .who b{font-weight:500}
[data-results] .examiner-id .role{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--body);
}
[data-results] .examiner-body{display:flex;flex-direction:column;gap:18px}
[data-results] .examiner-body p{
  font-family:var(--display);font-size:1.35rem;line-height:1.4;color:var(--ink);
  font-style:normal;font-weight:400;max-width:40ch;
}
[data-results] .examiner-body p em{font-style:italic;color:var(--ink)}
[data-results] .examiner-body .signoff{
  font-family:var(--sans);font-style:normal;font-size:12px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--body);margin-top:4px;
}

/* ── OFFER CARD ──────────────────────────────────────────────────── */
[data-results] .offer{
  margin-top:0;border:1px solid var(--line-strong);border-radius:4px;overflow:hidden;
  background:var(--paper);max-width:780px;margin-left:auto;margin-right:auto;
}
[data-results] .offer-head{
  background:transparent;border-bottom:1px solid var(--line);
  padding:18px 26px;display:flex;justify-content:space-between;align-items:center;
  font-family:var(--sans);font-size:12px;font-weight:600;letter-spacing:.06em;
  text-transform:none;color:var(--body);flex-wrap:wrap;gap:12px;
}
[data-results] .offer-head .pill{
  font-family:var(--sans);font-size:10px;letter-spacing:.16em;text-transform:uppercase;
  color:#fff;background:var(--rust);border:none;padding:5px 11px;border-radius:2px;
}
[data-results] .offer-body{display:grid;grid-template-columns:.85fr 1.15fr;gap:0}
[data-results] .offer-pane{padding:30px 26px}
[data-results] .offer-pane + .offer-pane{border-left:1px solid var(--line)}
[data-results] .offer-price-num{
  font-family:var(--display);font-size:3.4rem;font-weight:500;letter-spacing:0;
  color:var(--ink);line-height:1;
}
[data-results] .offer-price-lbl{
  margin-top:10px;font-family:var(--sans);font-size:.85rem;font-weight:600;
  letter-spacing:.02em;text-transform:none;color:var(--ink);
}
[data-results] .offer-price-meta{
  margin-top:14px;font-family:var(--sans);font-size:.9rem;line-height:1.5;color:var(--body);
}
[data-results] .offer-included{display:flex;flex-direction:column;gap:0}
[data-results] .offer-included .eyebrow,.offer-path .eyebrow{color:var(--rust)}
[data-results] .offer-list{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:9px}
[data-results] .offer-list li{
  position:relative;padding-left:22px;font-family:var(--sans);font-size:.95rem;color:var(--ink);
  display:block;gap:0;align-items:unset;line-height:1.5;
}
[data-results] .offer-list li::before{
  content:"✦";position:absolute;left:0;color:var(--gold);font-size:.85rem;
  font-family:var(--sans);font-style:normal;flex-shrink:0;
}
[data-results] .offer-path{
  margin-top:26px;padding-top:22px;border-top:1px solid var(--line);
  border-left:none;border-right:none;border-bottom:none;padding-left:0;padding-right:0;background:transparent;
}
[data-results] .offer-path .eyebrow{margin-bottom:0}
[data-results] .offer-path .row{margin-top:11px;font-size:.92rem;line-height:1.5;display:block;padding:0}
[data-results] .offer-path .row + .row{border-top:none}
[data-results] .offer-path .lbl{
  font-family:var(--sans);font-size:.92rem;letter-spacing:0;text-transform:none;
  color:var(--ink);font-weight:600;margin-right:6px;
}
[data-results] .offer-path .body{font-family:var(--sans);font-size:.92rem;color:var(--body);line-height:1.5}
[data-results] .offer-cta{
  padding:28px 26px;border-top:1px solid var(--line);text-align:center;
  display:flex;flex-direction:column;gap:0;align-items:center;
}
[data-results] .btn-ink{
  display:inline-flex;align-items:center;gap:.7em;background:var(--ink);color:#fff;
  font-family:var(--sans);font-weight:600;font-size:12px;text-transform:uppercase;
  letter-spacing:.16em;padding:17px 34px;border-radius:2px;border:none;cursor:pointer;
  transition:background .3s var(--ease),transform .3s var(--ease);width:auto;max-width:none;
}
[data-results] .btn-ink:hover{background:#000;transform:translateY(-1px);gap:.7em;color:#fff}
[data-results] .btn-ink .arrow{font-family:inherit;font-style:normal;font-size:inherit;letter-spacing:inherit;transition:transform .3s var(--ease)}
[data-results] .btn-ink:hover .arrow{transform:translateX(4px)}
[data-results] .booking-options{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:560px;margin:0 auto}
[data-results] .booking-options.virtual-first .btn-paper{order:-1;background:var(--ink);color:#fff;border-color:var(--ink)}
[data-results] .booking-options.virtual-first .btn-ink{background:var(--paper);color:var(--ink);border:1px solid var(--ink)}
[data-results] .btn-paper{
  display:inline-flex;align-items:center;justify-content:center;gap:.7em;width:auto;
  padding:17px 34px;border:1px solid var(--ink);background:var(--paper);color:var(--ink);
  font-family:var(--sans);font-weight:600;font-size:12px;letter-spacing:.16em;text-transform:uppercase;
  transition:background .3s var(--ease),transform .3s var(--ease);
}
[data-results] .btn-paper:hover{background:var(--paper-2);transform:translateY(-1px)}
[data-results] .btn-paper .arrow{font-family:inherit;font-style:normal;font-size:inherit;letter-spacing:inherit;transition:transform .3s var(--ease)}
[data-results] .btn-paper:hover .arrow{transform:translateX(4px)}
[data-results] .referral-note{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--rust);text-align:center;margin:0 0 14px;
}
[data-results] .offer-cta .fine{
  display:block;margin-top:14px;font-family:var(--sans);font-size:11px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--body);
}
[data-results] .offer-cta .guarantee{
  margin-top:18px;font-family:var(--sans);font-size:.9rem;line-height:1.5;max-width:52ch;
  margin-left:auto;margin-right:auto;color:var(--body);text-align:center;
  border-top:none;padding-top:0;
}
[data-results] .offer-cta .guarantee b{color:var(--ink);font-weight:600}

/* ── TESTIMONIAL ─────────────────────────────────────────────────── */
[data-results] .testimonial{margin-top:40px;text-align:center;padding:0 12px}
[data-results] .testimonial blockquote{
  font-family:var(--display);font-style:normal;font-weight:400;
  font-size:clamp(1.6rem,3.2vw,2.2rem);line-height:1.32;color:var(--ink);
  letter-spacing:0;max-width:26ch;margin:0 auto;
}
[data-results] .testimonial blockquote::before{display:none}
[data-results] .testimonial cite{
  font-style:normal;display:block;margin-top:22px;
  font-family:var(--sans);font-size:12px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--body);
}

/* ── ASIDE LINKS ─────────────────────────────────────────────────── */
[data-results] .aside-links{
  margin-top:44px;padding:0;display:flex;gap:28px;justify-content:center;flex-wrap:wrap;
  font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--body);
  max-width:none;
}
[data-results] .aside-links a{
  font-family:var(--sans);font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--body);text-align:center;padding:0 0 3px;border:none;border-bottom:1px solid var(--line-strong);
  border-radius:0;white-space:nowrap;background:transparent;
}
[data-results] .aside-links a:hover{color:var(--ink);border-color:var(--ink);background:transparent}
@media (max-width:520px){
  [data-results] .aside-links{flex-direction:column;align-items:center;padding:0}
  [data-results] .aside-links a{white-space:normal}
}

/* ── APPENDIX ────────────────────────────────────────────────────── */
[data-results] .appendix{
  border-top:1px solid var(--line);padding:48px 0 64px;background:var(--paper);
}
[data-results] .appendix summary{
  list-style:none;cursor:pointer;display:flex;justify-content:space-between;
  align-items:center;padding:22px 24px;
  border:1px solid var(--line);border-radius:14px;
  background:var(--paper);
  font-family:var(--mono);font-size:11px;letter-spacing:.24em;
  text-transform:uppercase;color:var(--ink-2);gap:16px;flex-wrap:wrap;
  transition:border-color .18s ease, background-color .18s ease;
}
[data-results] .appendix summary:hover{border-color:var(--ink);background:#f6f1e6}
[data-results] .appendix summary::-webkit-details-marker{display:none}
[data-results] .appendix summary .label{
  font-family:var(--display);font-style:italic;font-size:20px;
  letter-spacing:-0.01em;color:var(--ink);text-transform:none;
}
[data-results] .appendix summary .label::before{
  content:"§ ";font-style:italic;color:var(--accent);
}
[data-results] .appendix summary .toggle{
  font-family:var(--display);font-style:italic;font-size:24px;color:var(--accent);
  width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--accent);border-radius:50%;line-height:1;
  transition:transform .18s ease;
}
[data-results] details[open] .appendix summary .toggle,
[data-results] .appendix details[open] summary .toggle{transform:rotate(45deg)}
[data-results] .appendix-body{padding-top:32px;display:flex;flex-direction:column;gap:48px}

/* ── DOC FOOT ────────────────────────────────────────────────────── */
[data-results] .doc-foot{
  padding:48px 32px;border-top:1px solid var(--line);
  display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;align-items:end;
  font-family:var(--mono);font-size:10.5px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);max-width:1100px;margin:0 auto;
}
[data-results] .doc-foot .col b{
  color:var(--ink);font-weight:500;letter-spacing:.18em;
  display:block;margin-bottom:6px;
}
[data-results] .doc-foot .center{
  text-align:center;font-family:var(--display);font-style:italic;
  font-size:16px;letter-spacing:0;color:var(--ink-2);text-transform:none;
}
[data-results] .doc-foot .right{text-align:right}
[data-results] .doc-foot a:hover{color:var(--accent)}

/* ── SHARE STRIP ─────────────────────────────────────────────────── */
[data-results] .share-strip{
  text-align:center;padding:24px 32px;border-bottom:1px solid var(--line);
}
[data-results] .share-btn{
  display:inline-flex;align-items:center;gap:12px;
  font-family:var(--mono);font-size:11px;letter-spacing:.24em;
  text-transform:uppercase;color:var(--ink-2);
  background:transparent;border:1px solid var(--line-2);padding:12px 22px;
  cursor:pointer;border-radius:0;transition:color .2s,border-color .2s;
}
[data-results] .share-btn:hover:not(:disabled){color:var(--accent);border-color:var(--accent)}
[data-results] .share-btn:disabled{opacity:.55;cursor:not-allowed}
[data-results] .share-strip .fine{
  font-family:var(--mono);font-size:10px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);margin-top:10px;
}

/* ── MOBILE ──────────────────────────────────────────────────────── */
@media(max-width:720px){
  [data-results] .doc,[data-results] .doc-narrow{padding:0 20px}
  [data-results] .doc-bar{padding:18px 20px}
  [data-results] .doc-bar .center{display:none}
  [data-results] .hero-finding{padding:32px 0 8px}
  [data-results] .hero-meta{grid-template-columns:1fr}
  [data-results] .why-cards,[data-results] .cred-grid{grid-template-columns:1fr}
  [data-results] .chain-step,[data-results] .chain-cell{grid-template-columns:1fr;gap:8px}
  [data-results] .offer-body{grid-template-columns:1fr}
  [data-results] .offer-pane + .offer-pane{border-left:none;border-top:1px solid var(--line)}
  [data-results] .booking-options{grid-template-columns:1fr}
  [data-results] .booking-options.virtual-first .btn-paper{order:initial}
  [data-results] .doc-foot{grid-template-columns:1fr;text-align:left;gap:18px;padding:32px 20px}
  [data-results] .doc-foot .center,[data-results] .doc-foot .right{text-align:left}
}

@media(max-width:480px){
  [data-results] .offer-pane{padding:24px 20px}
  [data-results] .offer-price-num{font-size:3rem}
  [data-results] .btn-ink{padding:16px 24px}
}
`;

const ResultsPage = ({ firstName, patternSignature, scores, insights }: ResultsPageProps) => {
  const shareCardRef = useRef<HTMLDivElement>(null);
  const { share, state: shareState } = useShareResults(shareCardRef);
  const { answers } = useQuiz();
  const painLocation = (answers[0]?.answer as string) || null;
  const conditionContent = getConditionContent(painLocation);

  function buildBookingUrl(base: string): string {
    if (!painLocation) return base;
    const normalized = painLocation.toLowerCase().replace(/\s*\/\s*/g, '-').replace(/\s+/g, '-');
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}pain=${encodeURIComponent(normalized)}`;
  }

  const shareButtonLabel =
    shareState === 'capturing' ? 'Creating image…'
    : shareState === 'sharing'  ? 'Opening share sheet…'
    : shareState === 'downloaded' ? 'Image saved'
    : shareState === 'error'    ? 'Something went wrong'
    : 'Share your result';

  // Recovery reading text label (used in hero meta)
  const recoveryScore = scores.recoveryPotential;
  const recoveryWord =
    recoveryScore >= 75 ? 'High'
    : recoveryScore >= 60 ? 'Good'
    : recoveryScore >= 45 ? 'Moderate'
    : 'Limited';

  return (
    <div data-results>
      <style dangerouslySetInnerHTML={{ __html: EDITORIAL_STYLES }} />

      {/* Off-screen share card — captured by html2canvas on share click */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        <ShareCard ref={shareCardRef} patternSignature={patternSignature} scores={scores} />
      </div>

      {/* 1 — Doc bar */}
      <div className="doc-bar">
        <div className="doc-bar-inner">
          <a className="brand" href="https://www.amarimethod.com/">
            <span className="mark" aria-hidden="true" />
            <span>Amari Method</span>
          </a>
          <div className="center">Your result · Returned from Form 01</div>
          <div className="right">
            <a href="/quiz/take/">← Retake quiz</a>
          </div>
        </div>
      </div>

      {/* 2 — Hero finding */}
      <ResultsHero
        firstName={firstName}
        patternSignature={patternSignature}
        scores={scores}
        recoveryWord={recoveryWord}
      />

      {/* Share strip */}
      <div className="share-strip">
        <button
          onClick={share}
          disabled={shareState === 'capturing' || shareState === 'sharing'}
          className="share-btn"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span>{shareButtonLabel}</span>
        </button>
        <p className="fine">Save or share your reading</p>
      </div>

      {/* 3, 4, 5 — Condition story (why-3-up + protocol video + chain) */}
      {conditionContent ? <ConditionStory content={conditionContent} /> : null}

      {/* 6 — Examiner's note */}
      <section className="examiner doc">
        <div className="examiner-grid">
          <div className="examiner-id">
            <div className="examiner-avatar" aria-hidden="true">G</div>
            <div className="role">§ From your examiner</div>
            <div className="who"><b>Garrett Hewstan</b><br />Founder, Amari Method</div>
          </div>
          <div className="examiner-body">
            <p>
              What stood out in your answers: <em>{patternSignature.toLowerCase()}</em>. That means your body has built a chain around the original site. But the chain is <em>identifiable</em>, and your system hasn't built deep compensations yet.
            </p>
            <p>
              What I'd do next is simple: <em>book one session.</em> Not a package. Not a commitment. One. We find the specific imbalance creating your pattern and I show you the protocol that addresses it.
            </p>
            <p>
              If session one doesn't help, we don't keep going. <em>That's the whole offer.</em>
            </p>
            <p className="signoff">— Garrett</p>
          </div>
        </div>
      </section>

      {/* 7 — Offer card */}
      <section style={{ padding: '64px 0' }}>
        <div className="doc">
          <BookingCTA buildBookingUrl={buildBookingUrl} />
        </div>
      </section>

      {/* 8 — Testimonial (lives inside BookingCTA section already, but keep
              the aside links and appendix here at the page level) */}

      {/* 9 — Aside links */}
      <div className="doc">
        <div className="aside-links">
          <a href={buildBookingUrl('/book/discovery-call')}>
            Schedule free 15-min call ↗
          </a>
          <a href="https://www.amarimethod.com/booking">
            See full pricing &amp; packages ↗
          </a>
        </div>
      </div>

      {/* 10 — Appendix (collapsed) */}
      <section className="appendix">
        <div className="doc">
          <details>
            <summary>
              <span className="label">Appendix · See your full readout</span>
              <span className="mono">Six dimensions / Balance equation</span>
              <span className="toggle" aria-hidden="true">+</span>
            </summary>
            <div className="appendix-body">
              <InsightCards insights={insights} />
              <ScoreRadar scores={scores} />
              <div>
                <div className="section-head" style={{ paddingTop: 0 }}>
                  <span className="eyebrow">The balance equation</span>
                  <h2>Pain emerges when some parts <em>overwork</em> because other parts aren't working enough.</h2>
                </div>
                <div className="cred-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 32 }}>
                  <div className="cred-cell">
                    <ScoreCard
                      title="Active System"
                      subtitle="Muscles & Tendons"
                      score={scores.softTissueTension}
                      description="Your muscular system works to provide active support. Higher scores indicate your muscles are working overtime to create stability."
                    />
                  </div>
                  <div className="cred-cell">
                    <ScoreCard
                      title="Passive System"
                      subtitle="Bones & Ligaments"
                      score={scores.jointBoneAlignment}
                      description="Your skeletal system provides your structural foundation. Higher scores suggest alignment adaptations that affect how force transfers."
                    />
                  </div>
                </div>
                <div className="cred-grid">
                  <div className="cred-cell">
                    <ScoreCard
                      title="Pattern Duration"
                      score={scores.patternDuration}
                      description="How long your pattern has been developing affects how established the compensation pattern is."
                      compact
                    />
                  </div>
                  <div className="cred-cell">
                    <ScoreCard
                      title="Daily Impact"
                      score={scores.dailyActivitiesImpact}
                      description="How your pain affects your daily activities reveals functional limitations and compensations."
                      compact
                    />
                  </div>
                  <div className="cred-cell">
                    <ScoreCard
                      title="Body Adaptations"
                      score={scores.bodyAdaptations}
                      description="The degree to which your body has developed compensatory strategies around pain."
                      compact
                    />
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>
      </section>

      {/* 11 — Doc foot */}
      <footer className="doc-foot">
        <div className="col">
          <b>Form 02 · v1.0</b>
          <span>Returned 2026</span>
        </div>
        <div className="col center">A reading, not a diagnosis · Issued by Amari Method</div>
        <div className="col right">
          <b>Amari Method</b>
          <a href="https://www.amarimethod.com/">Return to home ↗</a>
        </div>
      </footer>
    </div>
  );
};

export default ResultsPage;
