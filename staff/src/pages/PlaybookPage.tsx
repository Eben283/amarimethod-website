import { useState } from 'react';

// Garrett-facing playbooks for in-call lookup. Mirrors
// amari/strategy/Discovery Call.md and amari/strategy/Partner Call.md.
// When either doc changes, update the matching section here.

type StepSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

function StepSection({ title, defaultOpen = false, children }: StepSectionProps) {
  return (
    <details className="staff-card p-0 overflow-hidden group" open={defaultOpen}>
      <summary className="px-4 py-3 cursor-pointer font-semibold text-amari-charcoal flex items-center justify-between min-h-[48px] list-none select-none">
        <span>{title}</span>
        <span className="text-amari-text-muted text-sm group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-3 text-sm text-amari-charcoal/90 leading-relaxed border-t border-amari-border/60">
        {children}
      </div>
    </details>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-amari-accent-warm pl-3 italic text-amari-charcoal/80 my-2">
      {children}
    </blockquote>
  );
}

// ── Discovery Call ──

function DiscoveryCallPlaybook() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-serif text-amari-charcoal mb-2">Discovery Call</h1>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed mb-2">
          15-minute call with a prospective client. Recommend the right tier and book it on the call.
        </p>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed italic">
          Scaffolding, not script. Each beat names the goal, the topics to cover, and the brand-aligned
          framing — but the exact words come from you. Rehearsed phrasings read as scripted from the
          prospect's chair.
        </p>
      </header>

      <div className="space-y-3">
        <StepSection title="0. Frame the call (~60 sec)">
          <p className="font-medium">Goal: set expectations so they don't spend the call waiting for a pitch.</p>
          <p>
            State that you'll listen first, then tell them what you think, then make a recommendation. Sets
            the order, removes anxiety about being sold.
          </p>
          <Quote>"Tell me what's going on. I'll listen, then I'll tell you what I think and what I'd recommend."</Quote>
          <p className="text-amari-text-muted text-xs italic pt-1">
            That single line is enough. Don't pad with small talk — you have 15 minutes.
          </p>
        </StepSection>

        <StepSection title="1. Listen (1–6 min)">
          <p className="font-medium">
            Goal: hear them fully. Trust comes from feeling heard before it comes from anything else.
          </p>
          <p className="font-medium pt-2">What to listen for (take notes):</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Body parts — specific ("right knee," "between the shoulder blades")</li>
            <li>Duration — how long, when it started, what triggered it</li>
            <li>What they've tried + why it stopped helping</li>
            <li>Functional impact — what they can't do anymore that matters to them ("can't sit through meetings," "can't sleep on my side," "can't pick up my kid")</li>
            <li>Emotional words — <em>"scared," "fed up," "hopeless," "at the end of my rope"</em></li>
          </ul>
          <p className="pt-2">
            Don't interrupt. Use minimal interjections only: <em>"Tell me more about that."</em>{' '}
            <em>"Keep going."</em> <em>"And then what happened?"</em>
          </p>
          <p className="font-medium pt-2">After they finish, up to 3 clarifiers:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Timing.</strong> <em>"Morning, after activity, end of day, or constant?"</em></li>
            <li><strong>What's been tried.</strong> <em>"What have you tried — what shifted, what didn't?"</em></li>
            <li><strong>Why now.</strong> <em>"Why now, instead of six months ago?"</em></li>
          </ol>
          <p className="text-amari-text-muted text-xs italic">Stop at 3. More feels like an intake form.</p>

          <p className="font-medium pt-2">Don't:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Interrupt to clarify (save it)</li>
            <li>Start diagnosing in your head while they're still talking</li>
            <li>Skip ahead to recommending</li>
          </ul>
        </StepSection>

        <StepSection title="2. Reflect (8–10 min)">
          <p className="font-medium">
            Goal: prove you heard them. This earns the right to diagnose.
          </p>
          <p>
            Mirror back the specifics they used — body part, duration, what they tried, functional impact,
            why now. End with <em>"is that about right?"</em> — gives them control to correct anything.
          </p>
          <p className="font-medium pt-2">Format:</p>
          <Quote>
            "OK so what I'm hearing is — [body part / duration] → [what they've tried + why it failed] →
            [functional impact] → [why now]. Is that about right?"
          </Quote>
          <p className="pt-2">
            If they correct you, listen and re-mirror. The correction itself is the trust signal.
          </p>
          <p className="font-medium pt-2">Don't:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Summarize abstractly</li>
            <li>Interpret yet ("sounds like an SI joint thing") — too early, you'll be wrong</li>
            <li>Say "I hear you" (reads as therapist-language; mirror with specifics instead)</li>
            <li>Skip ahead to "here's what Amari is"</li>
          </ul>
        </StepSection>

        <StepSection title="3. Diagnose + reframe (10–12 min)">
          <p className="font-medium">
            Goal: earn trust as someone who recognizes their pattern, then briefly reframe what they've tried
            so they understand why this work is different.
          </p>
          <p className="font-medium pt-2">Permission first:</p>
          <Quote>"OK so given all that — want to hear what I think?"</Quote>
          <p>Wait for yes. Everything that follows ties back to what <em>they</em> said.</p>

          <p className="font-medium pt-3">Lead with pattern recognition.</p>
          <p>
            Label the felt-sense of their situation first (e.g.,{' '}
            <em>"It sounds like you've been doing all the right things and none of it has held."</em>).
            Then signal you've seen this pattern many times. The move is confident reassurance from pattern
            recognition, in your voice.
          </p>

          <p className="font-medium pt-3">Name what's actually going on — without a rehearsed metaphor.</p>
          <p>The concept to land:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Their body has gone out of balance — one area is overworking, another isn't pulling its share</li>
            <li>The painful area is rarely the cause; it's where the overload shows up</li>
            <li>What they've tried treated the symptom, not the pattern</li>
          </ul>
          <p className="pt-2">
            Describe this in your own working language. If a metaphor comes naturally, use it. If it doesn't,
            don't force one — rehearsed metaphors read as scripted.
          </p>

          <p className="font-medium pt-3">Reframe what they've tried.</p>
          <p>For each modality they mentioned, the concept to land (in your words):</p>
          <table className="w-full text-sm border-collapse mt-2">
            <thead>
              <tr className="border-b border-amari-border">
                <th className="text-left py-1.5 pr-3 font-semibold text-amari-charcoal">What they tried</th>
                <th className="text-left py-1.5 font-semibold text-amari-charcoal">Concept to land</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-amari-border/40">
                <td className="py-2 pr-3 font-medium">PT</td>
                <td className="py-2">Loads the area that hurts — doesn't address the pattern overloading it</td>
              </tr>
              <tr className="border-b border-amari-border/40">
                <td className="py-2 pr-3 font-medium">Chiro</td>
                <td className="py-2">Done <em>to</em> them — body doesn't learn the new balance, imbalance pulls them back</td>
              </tr>
              <tr className="border-b border-amari-border/40">
                <td className="py-2 pr-3 font-medium">Stretching / yoga</td>
                <td className="py-2">Stretching a compensating muscle gives more slack to something that actually needs to hold tension</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Surgery</td>
                <td className="py-2">Surgery treats structure — what's driving structural failure is usually a pattern. Worth testing the pattern first when it's not an emergency</td>
              </tr>
            </tbody>
          </table>
          <p className="text-amari-text-muted text-xs italic pt-2">
            Pick only the modalities they brought up. Don't run through the whole list.
          </p>

          <p className="font-medium pt-3">~30 seconds on what Amari is.</p>
          <p>The positioning, per brand rules:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>A small set of <strong>protocols</strong> (not "exercises") that they learn and do at home</li>
            <li>Brings the body back into <strong>balance</strong> (not "fix")</li>
            <li>Most clients feel a shift in the first session</li>
            <li>A series is how the new balance actually holds</li>
          </ul>
          <p className="pt-2">
            Use your own working version. Don't lift marketing copy — it reads as a pitch.
          </p>

          <p className="font-medium pt-3">Don't:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Use rehearsed metaphors (suspension bridge, etc.) — they sound scripted</li>
            <li>Mention Network Spinal, chiropractic, or modality lineage</li>
            <li>Use the word "fix"</li>
            <li>Lead with credentials or years — earned position, doesn't need re-asserting</li>
          </ul>
        </StepSection>

        <StepSection title="4. Recommend + book (12–14 min)">
          <p className="font-medium">
            Goal: make the recommendation FOR them, then book it on the call.
          </p>
          <p>
            Don't ask <em>"Do you want to book your first session?"</em> — that puts the work back on them.
            Make a clear recommendation tied to what they told you.
          </p>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Stakes (~30 sec) — before the recommendation
            </h4>
            <p>Two halves, both pulled from specifics they actually said:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>What happens if they keep doing what they're doing</strong> — name the trajectory
                (6 months / a year / two years out). Use specifics they mentioned — not generic.
              </li>
              <li>
                <strong>What they get back</strong> — name the functional moments they said matter to them.
                Specifics again.
              </li>
            </ul>
            <p className="pt-2">
              Optional third beat: name the people their condition is affecting (spouse, kids, team). Use
              ONLY what they mentioned — don't extrapolate.
            </p>
            <p className="text-amari-text-muted text-xs italic pt-1">
              The stakes paragraph isn't fear-mongering — it's holding up a mirror to the trajectory they
              already described.
            </p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Recommend
            </h4>
            <Quote>
              "Based on what you've told me — [one-sentence reflection of what they said] — what I'd
              recommend is <strong>[tier]</strong>."
            </Quote>
            <p className="pt-2">Pick the tier from the table below. Then book it with an A/B time choice:</p>
            <Quote>"I've got [day at time] or [day at time] open. Which works?"</Quote>
            <p className="text-amari-text-muted text-xs italic pt-1">
              Why A/B beats open-ended: scanning their whole calendar = friction = "let me get back to you."
              A/B is a 1-second decision.
            </p>
            <p className="font-medium pt-2">Optional capacity context (use only if true):</p>
            <Quote>
              "For context, I take about 6 new series clients a month and Tuesday/Thursday afternoons fill
              2-3 weeks out."
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Which tier
            </h4>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-amari-border">
                  <th className="text-left py-1.5 pr-3 font-semibold text-amari-charcoal">What you heard</th>
                  <th className="text-left py-1.5 font-semibold text-amari-charcoal">Recommend</th>
                </tr>
              </thead>
              <tbody className="align-top">
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Acute, recent, healthy</td>
                  <td className="py-2 font-medium">Initial $225</td>
                </tr>
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Chronic, localized</td>
                  <td className="py-2 font-medium">4-pack $720</td>
                </tr>
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Chronic + multiple sites + been through the medical system</td>
                  <td className="py-2 font-medium">8-pack $1,295</td>
                </tr>
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Surgery deadline / urgent</td>
                  <td className="py-2 font-medium">8-pack $1,295</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Acute injury, red flags, neuro symptoms</td>
                  <td className="py-2 font-medium">Refer out</td>
                </tr>
              </tbody>
            </table>
            <p className="text-amari-text-muted text-xs italic pt-2">Pick one tier. Don't offer two.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              How to book it
            </h4>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Book the appointment in GHL during the call</li>
              <li>From the client's page in the staff app, tap the pay-link button for the recommended tier</li>
              <li>Stay on the line. Walk them through paying — script below</li>
              <li>Confirm payment came through. Confirm the slot back to them</li>
            </ol>
            <p className="text-amari-text-muted text-xs italic pt-1">
              Don't tell them about the iPad / policies. They'll sign when they arrive.
            </p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Sending the pay link — script
            </h4>
            <p className="font-medium">Frame it:</p>
            <Quote>
              "Great — let's lock you in. Texting you the link now. Should take about a minute — you can
              Apple Pay it. Stay on with me."
            </Quote>
            <p className="font-medium pt-2">Tap the button.</p>
            <p className="font-medium pt-2">Narrate while they tap:</p>
            <Quote>"Got the text? Tap that — Stripe, totally secure..."</Quote>
            <p className="font-medium pt-2">When it confirms:</p>
            <Quote>"Got it on my end. You're in for [day at time]. Looking forward to working with you."</Quote>
            <p className="font-medium pt-2">Rules:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>No link until you've heard a clear verbal yes</li>
              <li>Don't hang up before payment confirms</li>
              <li>Don't go silent while they pay — narrate</li>
              <li>Confirm immediately after payment lands</li>
            </ul>
          </div>
        </StepSection>

        <StepSection title="Objection cheat sheet">
          <div>
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "Can we just start with one?"
            </h4>
            <p>
              The concept: yes, and let them know the $225 applies as credit if they convert. Removes the
              financial penalty for trying a single session.
            </p>
            <Quote>
              "Yes, absolutely. Most people in your situation end up wanting the series after the first — so
              know the $225 applies as credit toward a series if you convert."
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "Let me think about it."
            </h4>
            <p className="text-amari-text-muted text-xs">
              On a discovery call (warm — they booked the call themselves), this usually means hidden
              constraint, fear of change, or a decision-maker not on the call. NOT a real "no." Treat as a
              signal to surface the actual obstacle.
            </p>
            <ol className="list-decimal pl-5 space-y-1 pt-2">
              <li>
                <strong>Label:</strong>{' '}
                <em>"It seems like there's something here that's not quite landing for you."</em>{' '}
                (pause, let them respond)
              </li>
              <li>
                <strong>Probe the real obstacle:</strong>{' '}
                <em>"What's the biggest thing you'd be weighing?"</em> OR — if it might be a decision-maker —{' '}
                <em>"How on board is [partner / household / boss] with this?"</em>
              </li>
              <li>
                <strong>Loss aversion:</strong> <em>"What happens if you do nothing?"</em>{' '}
                (back to what they already told you about their trajectory)
              </li>
              <li>
                <strong>Give them control:</strong> <em>"How would you like me to proceed?"</em>
              </li>
            </ol>
            <p className="text-amari-text-muted text-xs italic pt-2">
              Way more honest than scarcity ("Tuesday at 2 is the only slot...") and surfaces real
              objections instead of polite escape.
            </p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "I've tried everything, why would this be different?"
            </h4>
            <p>
              Concept: everything they've tried treated the area that hurts. We work on the pattern pulling
              the area into pain. That variable hasn't been tested.
            </p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "How do I know it'll work for me?"
            </h4>
            <p>Honest answer. Don't guarantee. Don't oversell.</p>
            <Quote>
              "I don't guarantee. Most clients feel a real shift in the first session. If you don't, we talk
              about whether to keep going. I'm not selling you something that isn't working for your body."
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "It's a lot of money."
            </h4>
            <p className="font-medium">The 1-to-10 scale move:</p>
            <Quote>
              "It is. Real quick — on a scale of 1 to 10, how ready are you to actually be out of pain?"
            </Quote>
            <p className="pl-3 mt-1">
              If <strong>8 or above:</strong>{' '}
              <em>
                "OK. Let's figure out what works for you. We can split it — half now, half at session 3 — if
                that helps."
              </em>
            </p>
            <p className="pl-3 mt-1">
              If <strong>7 or below:</strong>{' '}
              <em>
                "Got it. Then this might not be the right moment. Better to wait until you're actually ready
                than push through it now. Let me know when that shifts."
              </em>
            </p>
            <p className="text-amari-text-muted text-xs italic pt-2">
              The 7-or-below response is the honest move — preserves the relationship for when they're
              actually ready, instead of forcing a half-committed yes that won't stick.
            </p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "My doctor said I need surgery."
            </h4>
            <p>
              Concept: take that seriously. Surgery treats structure. What's driving the structural failure
              is usually a pattern. Test the pattern for a few sessions — if it improves, you've avoided
              something irreversible. If not, surgery is still there.
            </p>
          </div>
        </StepSection>

        <StepSection title="Post-call">
          <p>Within 5 minutes:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>If booked: confirm the appointment is in GHL, payment is logged, slot is on the calendar</li>
            <li>If not booked: note the reason and the followup date in the contact record</li>
            <li>
              If they declined for a real reason (timing, money, partner not on board): no follow-up
              sequence — just one personal note in 3-4 weeks
            </li>
          </ol>
        </StepSection>
      </div>
    </>
  );
}

// ── Partner Call ──

function PartnerCallPlaybook() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-serif text-amari-charcoal mb-2">Partner Call</h1>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed mb-2">
          Cold call to a golf pro, tennis pro, or fitness trainer in the SF Bay Area. Goal: book them for
          a free 60-minute session at the studio, and seed the expectation that this comp is the front end
          of a referral relationship — not a one-off gift.
        </p>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed italic">
          Scaffolding, not script. Each beat names the goal, the topics to cover, and brand-aligned
          framing — but the exact words come from you. Rehearsed phrasings read as scripted from a
          prospect's ear.
        </p>
      </header>

      <div className="space-y-3">
        <StepSection title="Pre-call (30 seconds)">
          <p className="font-medium">Goal: have one specific thing to mention. Cold-feeling calls don't convert.</p>
          <p className="font-medium pt-2">Glance at:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Their facility (so you can ask about a specific student type)</li>
            <li>Their LinkedIn or website — recent post, student win, club they teach at</li>
            <li>Geo tier — A = SF/Peninsula (primary), B = East Bay (secondary)</li>
          </ul>
          <p className="text-amari-text-muted text-xs italic pt-2">
            If they're tier B/C and you don't have shared context, don't call. Send a LinkedIn connect first.
          </p>
        </StepSection>

        <StepSection title="1. Open (first 15 seconds)">
          <p className="font-medium">
            Goal: disarm the "what does this guy want from me" reflex before saying who you are.
          </p>
          <p>
            The move: acknowledge the cold dynamic up front, then give them autonomy to reject the call
            ("is now a bad time"). Removes defensiveness without sounding falsely apologetic.
          </p>
          <Quote>
            "Hi [name], this is [your name] from Amari Method in SF. I know we haven't spoken before, and
            it probably seems like I'm just calling out of the blue to ask for a favor.{' '}
            <strong>Is now a bad time to talk?</strong>"
          </Quote>
          <p className="text-amari-text-muted text-xs italic pt-1">
            <strong>Why "is now a bad time" not "do you have a minute":</strong> pushing for a yes makes
            them defensive. "Is now a bad time" gives them a clean answer either direction.
          </p>
          <p className="text-amari-text-muted text-xs italic pt-1">
            <strong>Voice:</strong> slight smile, easygoing. Pause after the audit — don't fill the silence.
          </p>
          <p className="pt-2">
            If they say it IS a bad time → jump to Beat 5 to schedule a callback. Don't push.
          </p>
        </StepSection>

        <StepSection title="2. Ask about them (2–3 minutes)">
          <p className="font-medium">
            Goal: get them to articulate the problem you solve — without pitching anything.
          </p>
          <p>
            Use calibrated questions — open questions starting with "What" or "How" (never "Why" — sounds
            accusatory). They have no defined answer, which forces the prospect to think and articulate.
          </p>
          <p className="font-medium pt-2">Pick 2–3. Don't run all four:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><em>"What do you see as the biggest physical challenge your students are dealing with right now?"</em></li>
            <li><em>"When a student plateaus, what's usually the core issue you can't address with coaching alone?"</em></li>
            <li><em>"What's the most difficult thing for them to get around — the one that keeps coming back?"</em></li>
            <li><em>"What does it cost them — and you — when it doesn't get fixed?"</em> (loss-aversion bomb; optional, powerful)</li>
          </ol>

          <p className="font-medium pt-3">Listening discipline:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Don't interrupt</li>
            <li>
              After their answer, <strong>mirror</strong> the last 1-3 words back with an inquisitive upward
              tone — they'll elaborate
            </li>
            <li>
              <strong>Label</strong> what you hear (e.g.,{' '}
              <em>"It sounds like you've been carrying these students without anywhere to send them"</em>) —
              validates and builds trust
            </li>
          </ul>
          <p className="pt-2">
            This beat is NOT a setup for a pitch. It's reconnaissance + relationship. Most pros never get
            asked these questions by someone genuinely listening.
          </p>
        </StepSection>

        <StepSection title="3. Offer — the barter, not the gift">
          <p className="font-medium">
            Goal: frame the comp session as a trade, not a gift.
          </p>
          <p>
            Free triggers suspicion. Barter doesn't. Naming the trade upfront makes the comp the path TO
            the ask, not bait FOR the ask.
          </p>
          <Quote>
            "Here's why I'm calling. I normally charge $225 for a 60-minute session at my SF studio. I'm
            offering it free to a handful of [golf pros / trainers / tennis pros] right now because I want
            to be someone you can refer clients to for pain — or anything physical you can't fix as a
            coach. The only way that makes sense to me is if you've felt the work yourself first.{' '}
            <strong>Whether you decide to refer is up to you</strong> — but I'd want you to have actually
            felt it before deciding. Sound fair?"
          </Quote>
          <p className="font-medium pt-3">The 4 elements that have to be in there:</p>
          <table className="w-full text-sm border-collapse mt-2">
            <thead>
              <tr className="border-b border-amari-border">
                <th className="text-left py-1.5 pr-3 font-semibold text-amari-charcoal">Element</th>
                <th className="text-left py-1.5 font-semibold text-amari-charcoal">What it does</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-amari-border/40">
                <td className="py-2 pr-3 font-medium">Named price ($225)</td>
                <td className="py-2">Anchors value</td>
              </tr>
              <tr className="border-b border-amari-border/40">
                <td className="py-2 pr-3 font-medium">Named ask</td>
                <td className="py-2">"I want to be someone you can refer clients to" — kills the "what's the catch" reflex</td>
              </tr>
              <tr className="border-b border-amari-border/40">
                <td className="py-2 pr-3 font-medium">Why it makes sense</td>
                <td className="py-2">"Only way is if you've felt it" — explains the trade honestly</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Autonomy clause</td>
                <td className="py-2">"Whether you decide to refer is up to you" — kills reactance, increases compliance</td>
              </tr>
            </tbody>
          </table>
        </StepSection>

        <StepSection title="4. Frame what they get — 3-step plan, not modality">
          <p className="font-medium">
            Goal: don't explain Amari. Give them a 3-step plan where THEY are the hero.
          </p>
          <p>
            The prospect tunes out when they hear about YOU. They lean in when they hear a plan for THEM.
          </p>
          <p className="font-medium pt-2">The 3 steps to land (in your words):</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              <strong>You spot a student</strong> dealing with pain — or anything physical you can't fix as
              a coach
            </li>
            <li>
              <strong>You send them to me.</strong> I do the bodywork to unlock whatever's keeping their
              body from doing what you're coaching
            </li>
            <li>
              <strong>They come back to you</strong> physically able to break through — and you look like
              the coach who got them there
            </li>
          </ol>
          <p className="font-medium pt-3">Avoid:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>"Network Spinal," "rebalancing," "somatic" — modality lineage</li>
            <li>"25 years of practice" — any credentialing intro</li>
            <li>The word "fix"</li>
            <li>Explaining how the work works mechanically</li>
          </ul>
          <p className="text-amari-text-muted text-xs italic pt-2">The plan lands. Modality doesn't.</p>
        </StepSection>

        <StepSection title="5. Book — calendar commitment on this call">
          <p className="font-medium">
            Goal: lock in the calendar now, not "I'll get back to you."
          </p>
          <p>
            Most who say "I'll check my calendar" don't follow up. The rule: book a meeting from a meeting.
          </p>
          <p className="font-medium pt-2">The sequence:</p>
          <Quote>
            "Awesome. Let's get you on the calendar now so we don't lose momentum. Do mornings or afternoons
            work better?"
          </Quote>
          <p className="text-amari-text-muted text-xs italic">(Wait for answer.)</p>
          <Quote>
            "Perfect — I have [Tuesday at 9am] or [Thursday at 10:30am]. Which works better?"
          </Quote>
          <p className="text-amari-text-muted text-xs italic pt-1">
            A/B beats open-ended because "when are you free?" makes them scan their whole calendar
            (friction → punt).
          </p>

          <p className="font-medium pt-3">Once time is locked — then logistics:</p>
          <Quote>
            "Tuesday at 9am it is. I'll send you the calendar invite now. The studio's at [address] — wear
            something you can move in, you don't need to bring anything. We'll spend the first 10 minutes
            talking about what your body's been doing, then get on the table. You'll feel different walking
            out."
          </Quote>
          <p className="text-amari-text-muted text-xs italic pt-1">
            Don't explain logistics before the time is set — it gives them a reason to stall.
          </p>
        </StepSection>

        <StepSection title="6. Close the call">
          <Quote>"Great. Looking forward to [day/time]. Anything I should know before then?"</Quote>
          <p className="pt-2">
            Confirm. Hang up. Don't re-pitch, don't over-thank, don't add "feel free to call me if anything
            changes" (that's an out).
          </p>
        </StepSection>

        <StepSection title="Objection cheat sheet">
          <p>
            Don't argue. Don't logic. Pattern is always: <strong>mirror → label → calibrated question →
            no-oriented close.</strong> Slow, warm voice — fast or assertive delivery makes the techniques
            feel manipulative.
          </p>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "I'll think about it."
            </h4>
            <p className="text-amari-text-muted text-xs">
              Translation: they feel pressured, don't see the value yet, or are trying to politely escape.
            </p>
            <ol className="list-decimal pl-5 space-y-1 pt-1">
              <li><strong>Mirror:</strong> <em>"Think about it?"</em> (silence, wait)</li>
              <li><strong>Label:</strong> <em>"It sounds like there's a specific piece of this that doesn't quite sit right with you."</em></li>
              <li><strong>Calibrated:</strong> <em>"What's the biggest thing you'd be weighing?"</em></li>
              <li><strong>Close:</strong> <em>"Would it be a bad idea to put a tentative time on the calendar? Gives you time to think — you can cancel if it's a no."</em></li>
            </ol>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "Send me some info / email me details."
            </h4>
            <p className="text-amari-text-muted text-xs">
              Translation: counterfeit yes — they want off the phone without confrontation.
            </p>
            <ol className="list-decimal pl-5 space-y-1 pt-1">
              <li><strong>Mirror:</strong> <em>"Send some info?"</em> (silence)</li>
              <li><strong>Label:</strong> <em>"It sounds like you're slammed today and just want to get back to your day."</em></li>
              <li><strong>Calibrated:</strong> <em>"What would I need to include for it not to be just generic marketing material?"</em></li>
              <li><strong>Close:</strong> <em>"Are you against dropping a 10-minute placeholder on the calendar so we can see if what I send actually aligns?"</em></li>
            </ol>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "We already have someone we refer to."
            </h4>
            <p className="text-amari-text-muted text-xs">
              Translation: change is scary — current provider is the safe choice. Don't attack the
              incumbent; praise the loyalty.
            </p>
            <ol className="list-decimal pl-5 space-y-1 pt-1">
              <li><strong>Mirror:</strong> <em>"Someone you already refer to?"</em></li>
              <li><strong>Label:</strong> <em>"It sounds like you're loyal to the relationships you've built — that's how good practices run."</em></li>
              <li><strong>Calibrated:</strong> <em>"How are you handling the cases where your current person isn't quite the right fit?"</em></li>
              <li><strong>Close:</strong> <em>"Would it be ridiculous to do a brief session anyway, just so you know what I do for cases when your current person is booked or it's not their lane?"</em></li>
            </ol>
          </div>
        </StepSection>

        <StepSection title="Post-call">
          <p>Within 2 minutes:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              Log the outcome in <code>/staff/outreach</code> — <strong>Talked</strong> (and tick
              session-booked if applicable)
            </li>
            <li>
              Add a note with any specific student type or pain point they mentioned (so you can reference
              it when they walk in)
            </li>
            <li>Calendar invite goes out automatically from GHL</li>
          </ol>
        </StepSection>
      </div>
    </>
  );
}

// ── LinkedIn Connect ──

function LinkedInConnectPlaybook() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-serif text-amari-charcoal mb-2">LinkedIn First Message</h1>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed">
          Cold/cool outreach to a golf pro, tennis pro, or fitness trainer where the offer is a comped
          60-minute session at the SF studio. Works as a LinkedIn DM, SMS, or email body. Use after they
          accept your connection request.
        </p>
      </header>

      <div className="space-y-3">
        <StepSection title="The template" defaultOpen>
          <Quote>
            Hey [first name], [your name] from Amari Method here in SF. Wanted to comp you a 60-minute
            session at our studio. I want to be someone you can refer clients to for the body issues you
            see but can't fix as a coach — hip rotation, low-back tightness, whatever's tight. The only way
            that makes sense to me is if you've felt the work yourself first.
            <br /><br />
            Most pros end up finding a few things in their own body too. Whether you decide to refer is up
            to you. Want me to send the booking link?
          </Quote>
        </StepSection>

        <StepSection title="Why each line lands">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>"Hey [first name], [your name] from Amari Method here in SF"</strong> — natural DM
              opener, the way a person would actually start a message to a stranger.
            </li>
            <li>
              <strong>"Wanted to comp you a 60-minute session at our studio"</strong> — concrete offer with
              specific duration (no vague "full session" that leaves them wondering about commitment).
            </li>
            <li>
              <strong>"I want to be someone you can refer clients to..."</strong> — names the ask plainly.
              The whole point of the comp IS to earn a referral relationship; saying so directly is the
              respect move. Hiding the ask triggers the "what's the catch" reflex.
            </li>
            <li>
              <strong>Body-issue list</strong> — <em>"hip rotation, low-back tightness, whatever's tight"</em>{' '}
              — concrete, ends loose with "whatever's tight" which is how a real person trails off
              (not a copywriter).
            </li>
            <li>
              <strong>"The only way that makes sense to me is if you've felt the work yourself first"</strong>{' '}
              — explains the comp as the path to the ask. Quiet conviction.
            </li>
            <li>
              <strong>"Most pros end up finding a few things in their own body too"</strong> — personal-breakthrough
              seed. Kept understated.
            </li>
            <li>
              <strong>"Whether you decide to refer is up to you"</strong> — autonomy clause. Honest autonomy
              because the ask was named explicitly, not hedged "no expectation" framing.
            </li>
            <li>
              <strong>"Want me to send the booking link?"</strong> — plain question. Not a hard close, not
              a hedged ask.
            </li>
          </ul>
        </StepSection>

        <StepSection title="What to vary per recipient">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>[first name]</strong> — always personalize.</li>
            <li>
              <strong>Body-issue list</strong> — swap to match what their clients struggle with:
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>Golf: <em>"hip rotation and shoulder mobility, whatever's tight"</em></li>
                <li>Tennis: <em>"low-back tightness and rotation, whatever's stuck"</em></li>
                <li>General fitness: <em>"thoracic stiffness and ankle mobility"</em></li>
              </ul>
            </li>
            <li>Keep to two specific items + a loose trailing phrase.</li>
          </ul>
        </StepSection>

        <StepSection title="What NOT to change">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>The order:</strong> opener → offer → ask + niche → why-comp-makes-sense → personal seed → autonomy → CTA</li>
            <li><strong>The named ask</strong> (<em>"I want to be someone you can refer clients to"</em>) — don't revert to hedged "no expectation" framing</li>
            <li><strong>The autonomy clause</strong> (<em>"Whether you decide to refer is up to you"</em>) — this is what makes the named ask non-pressuring</li>
          </ul>
        </StepSection>

        <StepSection title="Connection request note (300 char max)">
          <p>
            LinkedIn caps connection-request notes at 300 characters. The full template above is ~575
            characters and won't fit. If they're a 3rd-degree connection, send this connection note first;
            once they accept, send the full DM above as message 1.
          </p>
          <Quote>
            Hi [first name] — [your name] here in SF. I run a somatic bodywork practice; most of my
            chronic-pain clients turn out to be golfers and tennis players. Would be good to be on each
            other's radar.
          </Quote>
          <p className="text-amari-text-muted text-xs pl-3 pt-1">(186 characters — fits comfortably.)</p>
        </StepSection>

        <StepSection title="When NOT to use this template">
          <ul className="list-disc pl-5 space-y-1">
            <li>If the prospect is themselves a chronic-pain sufferer or already a known referrer → skip the for-your-clients framing, go straight to the offer.</li>
            <li>If sending via voicemail → use the Partner Call script instead, not this written adaptation.</li>
            <li>If audience is a peer practitioner (DPT, chiropractor, massage therapist) → wrong category. Skip; they're not a referral partner, they're competitive overlap.</li>
          </ul>
        </StepSection>
      </div>
    </>
  );
}

// ── Tabbed shell ──

type Tab = 'discovery' | 'partner' | 'linkedin';

export default function PlaybookPage() {
  const [tab, setTab] = useState<Tab>('discovery');

  const tabClass = (active: boolean) =>
    `flex-1 py-2.5 px-3 text-sm font-medium rounded-md transition-colors min-h-[40px] ${
      active
        ? 'bg-white text-amari-charcoal shadow-sm'
        : 'text-amari-text-muted hover:text-amari-charcoal'
    }`;

  return (
    <div className="px-4 pt-4 pb-8 max-w-2xl mx-auto">
      <div className="sticky top-0 -mx-4 px-4 py-2 bg-amari-light-sand/95 backdrop-blur z-10 mb-3">
        <div className="flex gap-1 p-1 bg-amari-border/30 rounded-lg">
          <button onClick={() => setTab('discovery')} className={tabClass(tab === 'discovery')}>
            Discovery Call
          </button>
          <button onClick={() => setTab('partner')} className={tabClass(tab === 'partner')}>
            Partner Call
          </button>
          <button onClick={() => setTab('linkedin')} className={tabClass(tab === 'linkedin')}>
            LinkedIn DM
          </button>
        </div>
      </div>

      {tab === 'discovery' && <DiscoveryCallPlaybook />}
      {tab === 'partner' && <PartnerCallPlaybook />}
      {tab === 'linkedin' && <LinkedInConnectPlaybook />}
    </div>
  );
}
