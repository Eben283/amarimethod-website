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
// Mirrors the design tokens used on the quiz cover, About, Booking,
// Affiliate, and Blog pages. Scoped under [data-results] so it cannot
// bleed outside the React island.
const EDITORIAL_STYLES = `
[data-results] {
  --paper:#F7F2E8; --paper-2:#F0E9D8; --ink:#1F1D1A; --ink-2:#3A3733;
  --mute:#7A746B; --line:#E0D7C2; --line-2:#CCC1A8; --accent:#C56B4E;
  --display:'Bona Nova',Georgia,serif;
  --sans:'Inter',system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;
  background:var(--paper); color:var(--ink); font-family:var(--sans);
  -webkit-font-smoothing:antialiased; font-size:16px; line-height:1.55;
  overflow-x:hidden;
}
[data-results] *{box-sizing:border-box}
[data-results] a{color:inherit;text-decoration:none}
[data-results] img,[data-results] video{display:block;max-width:100%}
[data-results] h1,[data-results] h2,[data-results] h3,[data-results] h4{
  font-family:var(--display);font-weight:300;letter-spacing:-0.025em;
  line-height:1.05;color:var(--ink);text-wrap:balance;margin:0;
}
[data-results] p{text-wrap:pretty;margin:0}
[data-results] em{font-style:italic;color:var(--accent)}

[data-results] .doc{max-width:1100px;margin:0 auto;padding:0 32px}
[data-results] .doc-narrow{max-width:880px;margin:0 auto;padding:0 32px}

[data-results] .mono{
  font-family:var(--mono);font-size:11px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);
}

[data-results] .eyebrow{
  font-family:var(--mono);font-size:11px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);display:inline-flex;align-items:baseline;gap:6px;
}
[data-results] .eyebrow::before{
  content:"§";font-family:var(--display);font-style:italic;color:var(--accent);
  font-size:14px;letter-spacing:0;text-transform:none;
}

[data-results] .doc-bar{border-bottom:1px solid var(--line);background:var(--paper)}
[data-results] .doc-bar-inner{
  max-width:1100px;margin:0 auto;padding:14px 32px;
  display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:24px;
}
[data-results] .doc-bar .brand{
  font-family:var(--display);font-size:18px;letter-spacing:-0.01em;
  display:inline-flex;align-items:center;gap:10px;color:var(--ink);
}
[data-results] .doc-bar .brand .mark{
  width:18px;height:18px;border-radius:50%;background:var(--ink);position:relative;
}
[data-results] .doc-bar .brand .mark::after{
  content:"";position:absolute;inset:4px;border-radius:50%;background:var(--paper);
}
[data-results] .doc-bar .center{
  font-family:var(--mono);font-size:10.5px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);text-align:center;
}
[data-results] .doc-bar .right{
  font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink-2);
}
[data-results] .doc-bar .right a:hover{color:var(--accent)}

/* ── HERO ─────────────────────────────────────────────────────────── */
[data-results] .hero-finding{padding:80px 0 64px;text-align:center}
[data-results] .hero-stamp{
  display:inline-flex;align-items:center;gap:8px;
  font-family:var(--mono);font-size:11px;letter-spacing:.28em;
  text-transform:uppercase;color:var(--accent);
  border:1px solid var(--accent);padding:6px 14px;margin-bottom:32px;
}
[data-results] .hero-stamp .glyph{font-family:var(--display);font-style:italic;letter-spacing:0;font-size:14px}
[data-results] .hero-headline{
  font-family:var(--display);font-weight:300;
  font-size:clamp(40px,5.6vw,80px);letter-spacing:-0.035em;line-height:0.98;
  max-width:18ch;margin:0 auto 28px;
}
[data-results] .hero-sub{
  font-family:var(--display);font-style:italic;
  font-size:clamp(18px,2vw,22px);max-width:48ch;
  margin:0 auto 48px;color:var(--ink-2);line-height:1.45;font-weight:400;
}
[data-results] .hero-meta{
  display:grid;grid-template-columns:1fr 1fr;gap:0;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);
  max-width:680px;margin:0 auto;
}
[data-results] .hero-meta .cell{
  padding:24px 20px;text-align:center;
}
[data-results] .hero-meta .cell + .cell{border-left:1px solid var(--line)}
[data-results] .hero-meta .lbl{
  font-family:var(--mono);font-size:10px;letter-spacing:.24em;
  text-transform:uppercase;color:var(--mute);display:block;margin-bottom:8px;
}
[data-results] .hero-meta .val{
  font-family:var(--display);font-size:22px;font-style:italic;color:var(--ink);font-weight:400;
}
[data-results] .hero-meta .val em{color:var(--accent)}

/* ── SECTION HEAD ────────────────────────────────────────────────── */
[data-results] .section-head{padding:80px 0 32px;text-align:center}
[data-results] .section-head .eyebrow{margin-bottom:16px}
[data-results] .section-head h2{
  font-family:var(--display);font-size:clamp(28px,3.4vw,42px);font-weight:300;
  letter-spacing:-0.025em;line-height:1.08;max-width:24ch;margin:0 auto 16px;
}
[data-results] .section-head .lede{
  font-family:var(--display);font-style:italic;font-size:18px;color:var(--ink-2);
  max-width:52ch;margin:0 auto;line-height:1.5;
}

/* ── 3-UP CRED GRID ──────────────────────────────────────────────── */
[data-results] .cred-grid{
  display:grid;grid-template-columns:repeat(3,1fr);gap:0;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);
  margin:32px 0 64px;
}
[data-results] .cred-cell{padding:32px 24px;display:flex;flex-direction:column;gap:12px}
[data-results] .cred-cell + .cred-cell{border-left:1px solid var(--line)}
[data-results] .cred-cell .num{
  font-family:var(--mono);font-size:11px;letter-spacing:.24em;color:var(--accent);
}
[data-results] .cred-cell h3{
  font-family:var(--display);font-size:22px;font-weight:300;
  line-height:1.15;letter-spacing:-0.02em;color:var(--ink);
}
[data-results] .cred-cell p{
  font-family:var(--sans);font-size:15px;line-height:1.55;color:var(--ink-2);
}

/* ── PROTOCOL VIDEO BLOCK ────────────────────────────────────────── */
[data-results] .video-block{padding:48px 0 64px}
[data-results] .video-block .pull{
  font-family:var(--display);font-style:italic;font-size:22px;
  color:var(--ink-2);max-width:42ch;margin:24px auto 36px;
  text-align:center;line-height:1.45;font-weight:400;
}
[data-results] .video-frame-outer{
  position:relative;max-width:880px;margin:0 auto;
  padding:14px;border:1px dotted var(--line-2);
}
[data-results] .video-frame-outer::before,
[data-results] .video-frame-outer::after,
[data-results] .video-frame-outer .corner-bl,
[data-results] .video-frame-outer .corner-br{
  content:"";position:absolute;width:14px;height:14px;border:1px solid var(--line-2);
}
[data-results] .video-frame-outer::before{top:-7px;left:-7px;border-right:0;border-bottom:0}
[data-results] .video-frame-outer::after{top:-7px;right:-7px;border-left:0;border-bottom:0}
[data-results] .video-frame-outer .corner-bl{bottom:-7px;left:-7px;border-right:0;border-top:0}
[data-results] .video-frame-outer .corner-br{bottom:-7px;right:-7px;border-left:0;border-top:0}
[data-results] .video-frame-inner{
  border:1px solid var(--line);background:var(--paper-2);padding:8px;
}
[data-results] .video-frame-inner video{
  width:100%;aspect-ratio:16/9;background:#000;display:block;
}
[data-results] .video-cap{
  display:flex;justify-content:space-between;align-items:baseline;
  font-family:var(--mono);font-size:10.5px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);
  max-width:880px;margin:18px auto 0;flex-wrap:wrap;gap:8px;
}
[data-results] .video-note{
  font-family:var(--sans);font-size:14px;color:var(--ink-2);line-height:1.6;
  max-width:54ch;margin:24px auto 0;text-align:center;
}

/* ── CHAIN ────────────────────────────────────────────────────────── */
[data-results] .chain-grid{
  display:grid;grid-template-columns:repeat(3,1fr);gap:0;
  border-top:1px solid var(--ink);border-bottom:1px solid var(--line);
  margin:32px 0 24px;
}
[data-results] .chain-grid.is-4{grid-template-columns:repeat(2,1fr)}
@media(min-width:1024px){
  [data-results] .chain-grid.is-4{grid-template-columns:repeat(4,1fr)}
}
[data-results] .chain-cell{padding:32px 24px;display:flex;flex-direction:column;gap:12px}
[data-results] .chain-cell + .chain-cell{border-left:1px solid var(--line)}
[data-results] .chain-cell .num{
  font-family:var(--display);font-size:36px;font-style:italic;font-weight:300;
  color:var(--accent);line-height:1;
}
[data-results] .chain-cell .flow{
  font-family:var(--mono);font-size:10px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--mute);
}
[data-results] .chain-cell h3{
  font-family:var(--display);font-size:18px;font-weight:300;
  letter-spacing:-0.02em;line-height:1.2;color:var(--ink);
}
[data-results] .chain-cell p{
  font-family:var(--sans);font-size:14px;line-height:1.6;color:var(--ink-2);margin-top:auto;
}
[data-results] .chain-foot{
  text-align:center;font-family:var(--display);font-style:italic;
  font-size:18px;color:var(--ink-2);padding:12px 0 32px;
}
[data-results] .chain-foot a{color:var(--ink);border-bottom:1px solid var(--line-2)}
[data-results] .chain-foot a:hover{color:var(--accent);border-color:var(--accent)}

/* ── EXAMINER NOTE ────────────────────────────────────────────────── */
[data-results] .examiner{padding:64px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
[data-results] .examiner-grid{
  display:grid;grid-template-columns:1fr 2.4fr;gap:64px;align-items:start;
}
[data-results] .examiner-id{display:flex;flex-direction:column;gap:14px}
[data-results] .examiner-avatar{
  width:64px;height:64px;border-radius:50%;background:var(--ink);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--display);color:var(--paper);font-size:28px;font-style:italic;font-weight:400;
}
[data-results] .examiner-id .who{
  font-family:var(--display);font-size:20px;line-height:1.25;color:var(--ink);
}
[data-results] .examiner-id .who b{font-weight:400}
[data-results] .examiner-id .role{
  font-family:var(--mono);font-size:10px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);
}
[data-results] .examiner-body{display:flex;flex-direction:column;gap:24px}
[data-results] .examiner-body p{
  font-family:var(--display);font-size:21px;line-height:1.55;color:var(--ink);
  font-style:italic;font-weight:400;max-width:54ch;
}
[data-results] .examiner-body p em{font-style:italic;color:var(--accent)}
[data-results] .examiner-body .signoff{
  font-family:var(--display);font-style:italic;font-size:18px;color:var(--ink-2);
  margin-top:8px;
}

/* ── OFFER CARD ──────────────────────────────────────────────────── */
[data-results] .offer{
  border:1px solid var(--ink-2);background:var(--paper);
  max-width:780px;margin:0 auto;
}
[data-results] .offer-head{
  background:var(--paper-2);border-bottom:1px solid var(--ink-2);
  padding:18px 28px;display:flex;justify-content:space-between;align-items:center;
  font-family:var(--mono);font-size:10.5px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--ink);flex-wrap:wrap;gap:10px;
}
[data-results] .offer-head .pill{
  font-family:var(--mono);font-size:9.5px;letter-spacing:.2em;color:var(--accent);
  border:1px solid var(--accent);padding:4px 10px;
}
[data-results] .offer-body{
  display:grid;grid-template-columns:1fr 1.4fr;gap:0;
}
[data-results] .offer-pane{padding:32px 28px}
[data-results] .offer-pane + .offer-pane{border-left:1px solid var(--ink-2)}
[data-results] .offer-price-num{
  font-family:var(--display);font-size:72px;font-weight:300;letter-spacing:-0.025em;
  color:var(--ink);line-height:1;
}
[data-results] .offer-price-lbl{
  font-family:var(--mono);font-size:10px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);margin-top:12px;
}
[data-results] .offer-price-meta{
  font-family:var(--sans);font-size:13px;color:var(--ink-2);margin-top:18px;line-height:1.55;
}
[data-results] .offer-included{display:flex;flex-direction:column;gap:18px}
[data-results] .offer-included .eyebrow{margin-bottom:4px}
[data-results] .offer-list{display:flex;flex-direction:column;gap:10px}
[data-results] .offer-list li{
  display:flex;gap:12px;align-items:baseline;
  font-family:var(--sans);font-size:14.5px;color:var(--ink);line-height:1.5;
}
[data-results] .offer-list li::before{
  content:"✦";font-family:var(--display);font-style:italic;color:var(--accent);
  font-size:14px;flex-shrink:0;
}
[data-results] .offer-path{
  border:1px solid var(--line);padding:18px 20px;margin-top:18px;background:var(--paper);
}
[data-results] .offer-path .eyebrow{margin-bottom:14px}
[data-results] .offer-path .row{
  display:flex;flex-direction:column;gap:4px;padding:8px 0;
}
[data-results] .offer-path .row + .row{border-top:1px dotted var(--line-2)}
[data-results] .offer-path .lbl{
  font-family:var(--mono);font-size:10px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--ink);font-weight:500;
}
[data-results] .offer-path .body{
  font-family:var(--sans);font-size:14px;color:var(--ink-2);line-height:1.55;
}
[data-results] .offer-cta{
  border-top:1px solid var(--ink-2);padding:24px 28px;
  display:flex;flex-direction:column;gap:14px;align-items:center;
}
[data-results] .btn-ink{
  display:inline-flex;align-items:center;justify-content:center;gap:18px;
  background:var(--ink);color:var(--paper);
  font-family:var(--mono);font-size:12px;letter-spacing:.28em;
  text-transform:uppercase;padding:20px 40px;border:none;cursor:pointer;
  border-radius:0;transition:background .2s,gap .2s;
  width:100%;max-width:420px;
}
[data-results] .btn-ink:hover{background:var(--accent);gap:24px;color:var(--paper)}
[data-results] .btn-ink .arrow{font-family:var(--display);font-style:italic;font-size:18px;letter-spacing:0;line-height:0}
[data-results] .offer-cta .fine{
  font-family:var(--mono);font-size:10px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--mute);
}
[data-results] .offer-cta .guarantee{
  font-family:var(--sans);font-size:13.5px;line-height:1.6;color:var(--ink-2);
  text-align:center;max-width:54ch;border-top:1px dotted var(--line-2);
  padding-top:18px;margin-top:6px;
}
[data-results] .offer-cta .guarantee b{color:var(--ink);font-weight:600}

/* ── TESTIMONIAL ─────────────────────────────────────────────────── */
[data-results] .testimonial{padding:80px 0;text-align:center}
[data-results] .testimonial blockquote{
  font-family:var(--display);font-style:italic;font-weight:400;
  font-size:clamp(22px,2.6vw,32px);line-height:1.3;color:var(--ink);
  letter-spacing:-0.015em;max-width:42ch;margin:0 auto;
}
[data-results] .testimonial blockquote::before{
  content:"\\201C";font-family:var(--display);color:var(--accent);
  font-style:italic;font-size:36px;line-height:0;display:block;margin-bottom:8px;
}
[data-results] .testimonial cite{
  font-style:normal;display:block;margin-top:24px;
  font-family:var(--mono);font-size:11px;letter-spacing:.24em;
  text-transform:uppercase;color:var(--mute);
}

/* ── ASIDE LINKS — ghost-button pills (more visible secondary CTAs) ── */
[data-results] .aside-links{
  padding:32px 0;display:flex;justify-content:center;gap:14px;flex-wrap:wrap;
  max-width:780px;margin:0 auto;
}
[data-results] .aside-links a{
  font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;
  color:var(--ink);text-align:center;padding:14px 26px;
  border:1px solid var(--ink);border-radius:999px;
  transition:background-color .18s ease, color .18s ease;
  white-space:nowrap;
}
[data-results] .aside-links a:hover{background:var(--ink);color:var(--paper)}
@media (max-width:520px){
  [data-results] .aside-links{flex-direction:column;align-items:stretch;padding:24px 16px}
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
@media(max-width:880px){
  [data-results] .doc{padding:0 20px}
  [data-results] .doc-narrow{padding:0 20px}
  [data-results] .doc-bar-inner{grid-template-columns:auto 1fr;gap:14px;padding:12px 20px}
  [data-results] .doc-bar .center{display:none}
  [data-results] .hero-finding{padding:48px 0 40px}
  [data-results] .hero-meta{grid-template-columns:1fr}
  [data-results] .hero-meta .cell + .cell{border-left:0;border-top:1px solid var(--line)}
  [data-results] .section-head{padding:48px 0 24px}
  [data-results] .cred-grid{grid-template-columns:1fr;margin:24px 0 48px}
  [data-results] .cred-cell + .cred-cell{border-left:0;border-top:1px solid var(--line)}
  [data-results] .chain-grid,[data-results] .chain-grid.is-4{grid-template-columns:1fr;margin:24px 0 16px}
  [data-results] .chain-cell + .chain-cell{border-left:0;border-top:1px solid var(--line)}
  [data-results] .examiner{padding:48px 0}
  [data-results] .examiner-grid{grid-template-columns:1fr;gap:32px}
  [data-results] .offer-body{grid-template-columns:1fr}
  [data-results] .offer-pane + .offer-pane{border-left:0;border-top:1px solid var(--ink-2)}
  [data-results] .offer-cta{padding:20px}
  [data-results] .testimonial{padding:48px 0}
  /* aside-links responsive handling lives in its own @media (max-width:520px) above */
  [data-results] .doc-foot{grid-template-columns:1fr;text-align:left;gap:18px;padding:32px 20px}
  [data-results] .doc-foot .center,[data-results] .doc-foot .right{text-align:left}
  [data-results] .video-frame-outer{padding:8px}
}

@media(max-width:480px){
  [data-results] .offer-pane{padding:24px 20px}
  [data-results] .offer-price-num{font-size:56px}
  [data-results] .btn-ink{padding:18px 24px;font-size:11px;letter-spacing:.22em}
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
            <a href="/quiz/take/">← Retake assessment</a>
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
            <div className="who"><b>Dr. Garrett Hewstan</b><br />Founder, Amari Method</div>
          </div>
          <div className="examiner-body">
            <p>
              What stood out in your answers: <em>{patternSignature.toLowerCase()}</em>. That means your body has built a chain around the original site — but the chain is <em>identifiable</em>, and your system hasn't built deep compensations yet.
            </p>
            <p>
              What I'd do next is simple: <em>book one session.</em> Not a package. Not a commitment. One. We find the specific imbalance creating your pattern and I show you the protocol that addresses it.
            </p>
            <p>
              If session one doesn't help, we don't keep going. <em>That's the whole offer.</em>
            </p>
            <p className="signoff">— Dr. Garrett</p>
          </div>
        </div>
      </section>

      {/* 7 — Offer card */}
      <section style={{ padding: '64px 0' }}>
        <div className="doc">
          <BookingCTA patternSignature={patternSignature} buildBookingUrl={buildBookingUrl} />
        </div>
      </section>

      {/* 8 — Testimonial (lives inside BookingCTA section already, but keep
              the aside links and appendix here at the page level) */}

      {/* 9 — Aside links */}
      <div className="doc">
        <div className="aside-links">
          <a href={buildBookingUrl('/book-discovery-call')} target="_blank" rel="noopener noreferrer">
            Schedule free 15-min call ↗
          </a>
          <a href="https://www.amarimethod.com/booking" target="_blank" rel="noopener noreferrer">
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
