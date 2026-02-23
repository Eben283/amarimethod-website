import React from 'react';

type WelcomeScreenProps = {
  onStart: () => void;
};

// Each question gets its own drift animation + duration for organic feel
const floatingQuestions = [
  { text: 'Why does my pain keep coming back?',  style: { top: '18%',    left: '2%'    }, anim: 'float-q-1 10s ease-in-out infinite' },
  { text: 'Is this muscular or structural?',      style: { top: '40%',    left: '1.5%'  }, anim: 'float-q-2 13s ease-in-out infinite' },
  { text: "Why haven't treatments worked?",       style: { top: '20%',    right: '2%'   }, anim: 'float-q-3 11s ease-in-out infinite' },
  { text: 'Am I just getting older?',             style: { top: '57%',    left: '2%'    }, anim: 'float-q-4  9s ease-in-out infinite' },
  { text: 'Is tension part of the problem?',      style: { top: '60%',    right: '2.5%' }, anim: 'float-q-5 12s ease-in-out infinite' },
  { text: "What's actually out of balance?",      style: { bottom: '28%', left: '2%'    }, anim: 'float-q-6 14s ease-in-out infinite' },
  { text: 'Why does it hurt more some days?',     style: { bottom: '18%', right: '2%'   }, anim: 'float-q-7 10s ease-in-out infinite' },
];

// SVG spider/radar chart — 6 axes, fixed demo values
// Center (80,80), max radius 55. Angles clockwise from top: -90, -30, 30, 90, 150, 210 degrees
const AXES = [
  { label: 'Soft Tissue', angle: -90 },
  { label: 'Joint/Bone',  angle: -30 },
  { label: 'Duration',    angle:  30 },
  { label: 'Daily Impact',angle:  90 },
  { label: 'Adaptations', angle: 150 },
  { label: 'Recovery',    angle: 210 },
];
const CX = 80, CY = 80, R = 55;
const toRad = (deg: number) => (deg * Math.PI) / 180;

const pt = (angle: number, r: number) => ({
  x: CX + r * Math.cos(toRad(angle)),
  y: CY + r * Math.sin(toRad(angle)),
});

const DEMO_SCORES = [0.65, 0.52, 0.78, 0.60, 0.85, 0.72];

const gridRings = [0.33, 0.66, 1.0];

const SpiderChart = () => {
  const dataPoints = AXES.map((ax, i) => pt(ax.angle, R * DEMO_SCORES[i]));
  const dataPolygon = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox="0 0 160 160" className="w-full max-w-[180px] mx-auto block">
      {/* Grid rings */}
      {gridRings.map((level) => {
        const ringPts = AXES.map(ax => pt(ax.angle, R * level));
        const poly = ringPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        return (
          <polygon key={level} points={poly}
            fill="none" stroke="#D9CFBF" strokeWidth="0.8" />
        );
      })}

      {/* Spoke lines */}
      {AXES.map((ax) => {
        const tip = pt(ax.angle, R);
        return (
          <line key={ax.label}
            x1={CX} y1={CY} x2={tip.x.toFixed(1)} y2={tip.y.toFixed(1)}
            stroke="#D9CFBF" strokeWidth="0.8" />
        );
      })}

      {/* Data polygon */}
      <polygon points={dataPolygon}
        fill="#EBA584" fillOpacity="0.35"
        stroke="#EBA584" strokeWidth="1.8" strokeLinejoin="round" />

      {/* Data dots */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="3"
          fill="#EBA584" stroke="white" strokeWidth="1" />
      ))}
    </svg>
  );
};

const WelcomeScreen = ({ onStart }: WelcomeScreenProps) => {
  return (
    <div className="bg-amari-bone-white">

      {/* ── HERO SECTION ── */}
      <section className="relative min-h-[calc(100vh-72px)] flex items-center justify-center px-4 py-16 overflow-hidden">

        {/* Floating questions — desktop only, with drift animations */}
        {floatingQuestions.map((q, i) => (
          <span
            key={i}
            className="hidden md:block absolute text-xs font-sans pointer-events-none select-none whitespace-nowrap"
            style={{ ...q.style, color: '#5E8C8A', opacity: 0.55, animation: q.anim }}
          >
            {q.text}
          </span>
        ))}

        {/* Center content */}
        <div className="relative z-10 w-full max-w-lg text-center">

          {/* Social proof chip */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amari-pine-teal bg-opacity-10 rounded-full text-sm text-amari-pine-teal font-medium mb-6 font-sans">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
            </svg>
            <span>200+ clients helped find lasting relief</span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl md:text-5xl font-serif text-amari-charcoal leading-tight mb-5">
            In 3 minutes, you'll know exactly why your pain keeps coming back.
          </h1>

          <p className="text-base md:text-lg text-amari-text-light font-sans leading-relaxed mb-8 max-w-md mx-auto">
            Most people manage symptoms for years without addressing the real pattern. This assessment changes that.
          </p>

          {/* Feature card — Pattern Profile + Balance Equation preview */}
          <div className="bg-white rounded-xl p-5 shadow-md border border-amari-border max-w-sm mx-auto mb-8">
            <p className="text-xs uppercase tracking-widest font-semibold font-sans text-amari-pine-teal mb-1 text-center">
              Your pain pattern report
            </p>

            {/* Pattern signature badge */}
            <div className="flex justify-center mb-2">
              <span className="text-xs font-semibold font-sans px-3 py-1 rounded-full"
                style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#b45309' }}>
                Protective Tension
              </span>
            </div>

            {/* Pattern Profile — radar chart */}
            <SpiderChart />

            {/* Balance Equation — Active vs Passive bars */}
            <div className="mt-3 space-y-2.5 px-1">
              <p className="text-xs font-semibold text-amari-charcoal font-sans text-center mb-2 tracking-wide uppercase" style={{ fontSize: '0.65rem', letterSpacing: '0.07em', color: '#718096' }}>
                The Balance Equation
              </p>

              {/* Active System */}
              <div>
                <div className="flex justify-between text-xs font-sans mb-1">
                  <span className="text-amari-charcoal font-medium">Active System <span className="text-amari-text-light font-normal">· Muscles</span></span>
                  <span className="font-bold text-amari-charcoal">72%</span>
                </div>
                <div className="w-full rounded-full h-2 overflow-hidden" style={{ backgroundColor: '#e5e7eb' }}>
                  <div className="h-2 rounded-full" style={{ width: '72%', backgroundColor: '#9ca3af' }} />
                </div>
              </div>

              {/* Passive System */}
              <div>
                <div className="flex justify-between text-xs font-sans mb-1">
                  <span className="text-amari-charcoal font-medium">Passive System <span className="text-amari-text-light font-normal">· Structure</span></span>
                  <span className="font-bold text-amari-charcoal">48%</span>
                </div>
                <div className="w-full rounded-full h-2 overflow-hidden" style={{ backgroundColor: '#e5e7eb' }}>
                  <div className="h-2 rounded-full" style={{ width: '48%', backgroundColor: '#d1d5db' }} />
                </div>
              </div>

              {/* Recovery */}
              <div>
                <div className="flex justify-between text-xs font-sans mb-1">
                  <span className="text-amari-charcoal font-medium">Recovery Potential</span>
                  <span className="font-bold text-amari-charcoal">72%</span>
                </div>
                <div className="w-full rounded-full h-2 overflow-hidden" style={{ backgroundColor: '#e5e7eb' }}>
                  <div className="h-2 rounded-full" style={{ width: '72%', backgroundColor: '#EBA584' }} />
                </div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <button onClick={onStart} className="btn-primary w-full max-w-sm mx-auto block">
            <span>Start My Assessment<span className="arrow">→</span></span>
          </button>

          {/* Meta row */}
          <div className="flex items-center justify-center gap-4 text-xs text-amari-text-light font-sans mt-5">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ~3 minutes
            </span>
            <span className="text-amari-oat">·</span>
            <span>Free</span>
            <span className="text-amari-oat">·</span>
            <span>5 pain patterns</span>
          </div>
        </div>
      </section>

      {/* ── WHAT YOU'LL DISCOVER ── */}
      <section className="px-4 py-16 bg-white border-t border-amari-border">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-serif text-amari-charcoal text-center mb-10">
            What you'll discover
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            <div className="bg-amari-bone-white rounded-xl p-6 border border-amari-border">
              <div className="w-10 h-10 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(94,140,138,0.12)' }}>
                <svg className="w-5 h-5 text-amari-pine-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="font-serif text-lg text-amari-charcoal mb-2">Your Pain Pattern Signature</h3>
              <p className="text-sm font-sans text-amari-text-light leading-relaxed">
                Which of 5 distinct patterns is driving your symptoms — and what it means for how you move.
              </p>
            </div>

            <div className="bg-amari-bone-white rounded-xl p-6 border border-amari-border">
              <div className="w-10 h-10 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(235,165,132,0.15)' }}>
                <svg className="w-5 h-5" style={{ color: '#EBA584' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="font-serif text-lg text-amari-charcoal mb-2">Your Recovery Potential Score</h3>
              <p className="text-sm font-sans text-amari-text-light leading-relaxed">
                A 0–100 rating showing how well-positioned your body is to respond to the right approach.
              </p>
            </div>

            <div className="bg-amari-bone-white rounded-xl p-6 border border-amari-border">
              <div className="w-10 h-10 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(94,140,138,0.12)' }}>
                <svg className="w-5 h-5 text-amari-pine-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-serif text-lg text-amari-charcoal mb-2">Why Past Treatments Missed</h3>
              <p className="text-sm font-sans text-amari-text-light leading-relaxed">
                The specific imbalance that conventional approaches typically overlook — and why it matters.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ── WHO TAKES THIS ── */}
      <section className="px-4 py-14 bg-amari-bone-white border-t border-amari-border">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-serif text-amari-charcoal text-center mb-8">
            Who takes this?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">

            <div className="bg-white rounded-xl p-5 border border-amari-border flex items-start gap-4">
              <span className="text-2xl leading-none flex-shrink-0">🔄</span>
              <div>
                <p className="font-serif text-amari-charcoal font-medium mb-0.5">People with recurring pain</p>
                <p className="text-xs font-sans text-amari-text-light">"It keeps coming back no matter what I try."</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 border border-amari-border flex items-start gap-4">
              <span className="text-2xl leading-none flex-shrink-0">🔍</span>
              <div>
                <p className="font-serif text-amari-charcoal font-medium mb-0.5">Tried-everything people</p>
                <p className="text-xs font-sans text-amari-text-light">"Nothing has given me lasting relief."</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 border border-amari-border flex items-start gap-4">
              <span className="text-2xl leading-none flex-shrink-0">🎯</span>
              <div>
                <p className="font-serif text-amari-charcoal font-medium mb-0.5">Root-cause seekers</p>
                <p className="text-xs font-sans text-amari-text-light">"I want answers, not just temporary relief."</p>
              </div>
            </div>

          </div>

          <div className="text-center">
            <button onClick={onStart} className="btn-primary">
              <span>Start My Assessment<span className="arrow">→</span></span>
            </button>
            <p className="text-xs text-amari-text-light font-sans mt-3">
              ~3 minutes · Free · No spam
            </p>
          </div>
        </div>
      </section>

    </div>
  );
};

export default WelcomeScreen;
