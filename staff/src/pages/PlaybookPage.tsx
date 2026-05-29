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
        <p className="text-sm text-amari-charcoal/80 leading-relaxed">
          15-minute call. Recommend a session or series and book it.
        </p>
      </header>

      <section className="staff-card mb-4">
        <ul className="text-sm text-amari-charcoal/90 leading-relaxed space-y-1 pl-1">
          <li><strong>Listen</strong> → they trust a recommendation only after they feel heard</li>
          <li><strong>Reflect</strong> → proves you understood, earns the right to diagnose</li>
          <li><strong>Diagnose + reframe</strong> → distinguishes the work from what they've tried, justifies the price</li>
          <li><strong>Recommend + book</strong> → the close</li>
        </ul>
      </section>

      <div className="space-y-3">
        <StepSection title="0. Frame the call (~60 sec)">
          <Quote>"Tell me what's going on. I'll listen, then tell you what I think and what I'd recommend."</Quote>
        </StepSection>

        <StepSection title="1. Listen (1–6 min)">
          <p>Don't interrupt. Take notes on:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Body parts ("right knee," "between the shoulder blades")</li>
            <li>Duration ("6 months," "since my kid was born")</li>
            <li>What they've tried + why it stopped helping</li>
            <li>Functional impact ("can't sit through meetings," "can't sleep on my side")</li>
            <li>Emotional words ("scared," "fed up," "hopeless")</li>
          </ul>
          <p>
            Permissible interjections: <em>"Keep going."</em> <em>"Tell me more about that."</em>{' '}
            <em>"And then what happened?"</em>
          </p>
          <p className="font-medium pt-2">After they finish, up to 3 clarifiers:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Timing.</strong> "Morning, after activity, end of day, or constant?"</li>
            <li><strong>What's been tried.</strong> "What have you tried — what shifted, what didn't?"</li>
            <li><strong>Why now.</strong> "Why now, instead of six months ago?"</li>
          </ol>
          <p className="text-amari-text-muted">Stop at 3. More feels like an intake form.</p>
        </StepSection>

        <StepSection title="2. Reflect (8–10 min)">
          <p>Mirror their specifics back.</p>
          <p className="font-medium">Format:</p>
          <Quote>
            "OK so what I'm hearing is — [body part / duration] → [what they've tried + why it failed] →
            [functional impact] → [why now]. Is that about right?"
          </Quote>
          <p className="font-medium">Example.</p>
          <p>
            They said <em>"my lower back's been killing me for 8 months, PT helped briefly then failed, GP
            wants an MRI, can't pick up my kid":</em>
          </p>
          <Quote>
            "8 months of lower back pain, PT helped briefly but didn't hold, MRI on the table, and it's
            affecting things you care about like picking up your kid. Is that about right?"
          </Quote>
          <p className="font-medium pt-2">
            Don't: summarize abstractly. Interpret yet. Say "I hear you." Skip ahead to "here's what Amari is."
          </p>
        </StepSection>

        <StepSection title="3. Diagnose + reframe (10–12 min)">
          <p className="font-medium">Ask permission first:</p>
          <Quote>"OK so given all that — want to hear what I think?"</Quote>
          <p>Wait for yes. Tie everything that follows to what <em>they</em> said.</p>

          <p className="font-medium">Lead with pattern recognition:</p>
          <Quote>"Honestly — I've seen this 6, 12, 15, 25 times before. It moves. It doesn't stay where it is."</Quote>
          <p>Adjust the number to whatever's true.</p>

          <p className="font-medium">Underlying frame:</p>
          <Quote>
            "Your body is a suspension bridge. Every part is designed to hold the load equally. When one part
            is doing too much and another isn't doing enough, the overworked part is where pain shows up. The
            body isn't asking for surgery or stretching — it's asking for balance."
          </Quote>
          <p className="font-medium">Format:</p>
          <Quote>
            "Here's what I think is going on. [Where they're out of balance — what's overworking, what isn't
            doing its share]. The reason [what they tried] didn't hold is [explanation]. You're not broken —
            [reframe]."
          </Quote>
          <p className="font-medium pt-1">Reframes by what they've been told:</p>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "You need surgery."
              </p>
              <Quote>
                "Surgery is for true emergencies — arm-falling-off, car accident. Most surgery treats an
                out-of-balance body biomechanically — like putting a plastic bag where the window should be.
                Worth trying balance before something irreversible."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "PT helped, then stopped."
              </p>
              <Quote>
                "PT is muscular-based — it loads the area that hurts. It doesn't look at how the whole body
                shares the load. Strengthening a part that's already overworking just trains the imbalance
                harder. That's why it didn't hold."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "Just stretch / do core work."
              </p>
              <Quote>
                "Stretching is half the story. The tight part is overworking because something else isn't
                doing its share. Stretch the tight part and you've ignored the other half. We find what isn't
                engaged, bring it online — the tight part lets go on its own."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "Chiro didn't hold."
              </p>
              <Quote>
                "Chiro is done <em>to</em> you — you lay passively while someone forces the structure. Gives
                relief, but your body didn't learn anything. The minute you leave, your imbalance pulls you
                back. You do the work here, so your body learns the new balance."
              </Quote>
            </div>
          </div>

          <p className="font-medium pt-2">Then, 30 seconds on Amari:</p>
          <Quote>
            "I teach a small set of protocols — 8 in total, most people only need 3 or 4 for what their body
            needs. They bring you back into balance, every part sharing the load. Most clients feel a shift in
            the first session. We refine it over a series so it holds."
          </Quote>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Timeline language
            </h4>
            <p>
              <strong>Don't say:</strong> <em>"It takes months to learn anything."</em>
            </p>
            <p className="font-medium mt-3">Say:</p>
            <Quote>
              "You'll feel shifts in your first session. The real work is over the next few months — your body
              learning to hold the new balance without me. That's why I work in series, not one-offs."
            </Quote>
            <Quote>
              "Short term, you feel shifts. Long term, balance — and balance takes a few months to actually
              hold."
            </Quote>
          </div>
        </StepSection>

        <StepSection title="4. Recommend + book (12–14 min)">
          <p>
            Make the recommendation <em>for</em> them — don't ask{' '}
            <em>"Do you want to book your first session?"</em>
          </p>

          <div className="pt-2">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Stakes (~30 sec)
            </h4>
            <p>Before the tier — negative and positive, both from specifics they actually said.</p>
            <Quote>
              "The thing is — this kind of pattern doesn't resolve on its own. 6 months from now you're still
              working around it; couple years the MRI conversation gets heavier, not lighter. What I see for
              you on the other side — [picking up your kid without thinking, sleeping on your side, sitting
              through a meeting and forgetting you have a back]."
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Recommend + real capacity
            </h4>
            <Quote>
              "Based on what you've told me — [one-sentence reflection] — what I'd recommend is{' '}
              <strong>[tier]</strong>. For context, I take about 6 new series clients a month and
              Tuesday/Thursday afternoons fill 2-3 weeks out. I've got [day at time] or [day at time] open.
              Which works?"
            </Quote>
            <p>Use real numbers.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Example (full flow)
            </h4>
            <Quote>
              "This kind of pattern doesn't resolve on its own. 6 months from now you're still working around
              it; couple years the MRI conversation gets heavier. What I see for you on the other side —
              picking up your kid without thinking, sleeping on your side again, sitting through a meeting
              and forgetting you have a back.
              <br /><br />
              Based on what you've told me — 8 months in, PT didn't hold, getting in the way of stuff you
              care about — what I'd recommend is the 8-session series. For context, I take about 6 new
              series clients a month and afternoons fill 2-3 weeks out. I've got Tuesday at 2 or Thursday
              at 11 open this week. Which works?"
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
            <p className="text-amari-text-muted mt-2">Pick one tier.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              How to book it
            </h4>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Book the appointment in GHL during the call.</li>
              <li>From the client's page in the staff app, tap the pay-link button for the recommended tier (Initial / 4-pack / 8-pack).</li>
              <li>Stay on the line. Walk them through paying — script below.</li>
              <li>Confirm payment came through. Confirm the slot back to them.</li>
            </ol>
            <p className="text-amari-text-muted">Don't tell them about the iPad / policies. They'll sign when they arrive.</p>
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
            <p className="font-medium">Tap the button.</p>
            <p className="font-medium">Narrate while they tap:</p>
            <Quote>"Got the text? Tap that — Stripe, totally secure..."</Quote>
            <p className="font-medium">When it confirms:</p>
            <Quote>
              "Got it on my end. You're in for Tuesday at 2. Looking forward to working with you."
            </Quote>
            <p className="font-medium pt-2">Rules:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>No link until you've heard a clear verbal yes</li>
              <li>Don't hang up before payment confirms</li>
              <li>Don't go silent while they pay — narrate</li>
              <li>Confirm immediately after payment lands</li>
            </ul>
          </div>
        </StepSection>

        <StepSection title="Handling push-back + objections (anytime)">
          <div>
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Push-back on the close
            </h4>
            <p className="font-medium">"Can we just start with one?"</p>
            <Quote>
              "Yes, absolutely. Most people in your situation end up wanting the series after the first — so
              know the $225 applies as credit toward a series if you convert."
            </Quote>
            <p className="font-medium pt-2">"Let me think about it."</p>
            <Quote>
              "Of course. Honestly — Tuesday at 2 is the next opening I have until [next available slot]. If
              you want it I'll hold it through tomorrow evening; after that I have to open it back up. Take
              your time either way."
            </Quote>
            <p className="text-amari-text-muted">Only say it if it's true.</p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Top objections
            </h4>
            <p className="font-medium">"I've tried everything, why would this be different?"</p>
            <Quote>
              "Everything you've tried treated the area that hurts. We work on what's pulling the area into
              pain. If no one's worked on the pattern instead of the symptom, that variable hasn't been
              tested."
            </Quote>
            <p className="font-medium pt-2">"How do I know it'll work for me?"</p>
            <Quote>
              "I don't guarantee. Most clients feel a real shift in the first session. If you don't, we talk
              about whether to keep going. I'm not selling you something that isn't working for your body."
            </Quote>
            <p className="font-medium pt-2">"It's a lot of money."</p>
            <Quote>"It is. Real quick — on a scale of 1 to 10, how ready are you to actually be out of pain?"</Quote>
            <p className="pl-3 mt-1">
              If <strong>8 or above:</strong> <em>"OK. Let's figure out what works for you. We can split it — half now, half at session 3 — if that helps."</em>
            </p>
            <p className="pl-3 mt-1">
              If <strong>7 or below:</strong> <em>"Got it. Then this might not be the right moment. Better to wait until you're actually ready than push through it now. Let me know when that shifts."</em>
            </p>
            <p className="font-medium pt-2">"My doctor said I need surgery."</p>
            <Quote>
              "Take that seriously. Surgery treats the structure. What's driving the structure to fail is
              usually a pattern. Work on the pattern for a few sessions — if it improves, you've avoided
              something irreversible. If not, surgery is still there."
            </Quote>
          </div>
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
          Cold call to a golf pro, tennis pro, or fitness trainer in the SF Bay Area.
        </p>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed">
          The goal: book them for a free 60-minute session at the studio, AND seed the
          expectation that this comp is the front end of a referral relationship — not a one-off gift.
        </p>
      </header>

      <section className="staff-card mb-4">
        <h3 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
          Pre-call (30 seconds)
        </h3>
        <p className="text-sm text-amari-charcoal/90 leading-relaxed mb-2">
          Before dialing, glance at:
        </p>
        <ul className="text-sm text-amari-charcoal/90 leading-relaxed space-y-1 pl-5 list-disc">
          <li>Their facility (so you can ask about a specific student type)</li>
          <li>Their LinkedIn or website (recent post, student win, club they teach at)</li>
          <li>Geo tier (A = SF/Peninsula = primary; B = East Bay = secondary)</li>
        </ul>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed mt-2 italic">
          If they're tier B or C and you don't have any shared context, don't call. Send a LinkedIn connect first.
        </p>
      </section>

      <div className="space-y-3">
        <StepSection title="1. Open (first 15 seconds)">
          <p className="font-medium">
            Goal: disarm the "what does this guy want from me" reflex before saying who you are.
          </p>
          <p>
            The prospect is in defensive mode the moment they pick up. Naming it ("you're probably going
            to hate this call") and giving them autonomy to reject ("is now a bad time") removes the
            defensiveness.
          </p>
          <Quote>
            "Hi [name], this is [your name] from Amari Method in SF. You're probably going to hate this
            call because I'm a complete stranger interrupting your day. <strong>Is now a bad time to talk?</strong>"
          </Quote>
          <p className="font-medium pt-2">Why "is now a bad time" beats "do you have a minute":</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>"Do you have a minute" pushes for a yes → they go defensive</li>
            <li>"Is now a bad time" lets them say "no, it's fine" (full attention) OR "yes, kind of" (clean reschedule, no awkward hang-up)</li>
          </ul>
          <p className="pt-2">
            <strong>Voice:</strong> slight smile, easygoing tone. Don't try this rushed or assertive — it'll
            feel like a script. If they say "yes, it's a bad time" — jump to Beat 5 and book a callback.
            Don't push.
          </p>
        </StepSection>

        <StepSection title="2. Ask about them (2–3 minutes)">
          <p className="font-medium">
            Goal: get them to articulate the problem you solve — without pitching anything.
          </p>
          <p>
            Use calibrated questions — open questions starting with "What" or "How" (never "Why" — sounds
            accusatory). They have no defined answer, which forces the prospect to think and articulate,
            while giving them the illusion of control.
          </p>
          <p className="font-medium pt-2">Pick 2–3. Don't run all four.</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><em>"What do you see as the biggest physical challenge your students are dealing with right now?"</em></li>
            <li><em>"When a student plateaus, what's usually the core issue you can't address with coaching alone?"</em></li>
            <li><em>"What's the most difficult thing for them to get around — the one that keeps coming back?"</em></li>
            <li><em>"What does it cost them — and you — when it doesn't get fixed?"</em></li>
          </ol>
          <p className="pt-2">The last one is the loss-aversion bomb. Optional but powerful.</p>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Listening discipline
            </h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>Don't interrupt.</li>
              <li>
                After their answer, <strong>mirror</strong> the last 1-3 words back with an inquisitive upward
                tone. They'll elaborate.{' '}
                <em>("...so it's mostly their hips" / "Their hips?" / longer answer.)</em>
              </li>
              <li>
                <strong>Label</strong> what you hear:{' '}
                <em>"It sounds like you've been carrying these students for months without anywhere to send them."</em>{' '}
                Validates and builds trust.
              </li>
            </ul>
            <p className="pt-2">
              This beat is NOT a setup for a pitch. It's reconnaissance + relationship. Most pros never get
              asked these questions by someone genuinely listening. That alone earns goodwill.
            </p>
          </div>
        </StepSection>

        <StepSection title="3. Offer — the barter, not the gift">
          <p className="font-medium">
            Goal: frame the comp session as a trade, not a gift.
          </p>
          <p>
            Free triggers suspicion. Barter doesn't. The fatal move is offering "a free session, hope you
            like it" — the prospect spends the comp waiting for the pitch. Naming the trade upfront makes
            the comp the path TO the ask, not bait FOR the ask.
          </p>
          <Quote>
            "Here's why I'm calling. I normally charge $225 for a 60-minute session at my SF studio. I'm
            offering it free to a handful of [golf pros / trainers / tennis pros] right now because I want
            to be someone you can refer clients to for the body stuff you can't fix as a coach. The only
            way that makes sense to me is if you've felt the work yourself first.{' '}
            <strong>Whether you decide to refer is up to you</strong> — but I'd want you to have actually
            felt it before deciding. Sound fair?"
          </Quote>
          <p className="font-medium pt-2">The 4 critical elements:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Named price</strong> ($225) — anchors the value</li>
            <li><strong>Named ask</strong> ("I want to be someone you can refer clients to") — kills the "what's the catch" reflex</li>
            <li><strong>Why it makes sense</strong> ("only way is if you've felt it") — explains the trade honestly</li>
            <li><strong>Autonomy clause</strong> ("whether you decide to refer is up to you") — kills reactance, increases compliance</li>
          </ol>
        </StepSection>

        <StepSection title="4. Frame what they get — 3-step plan, not modality">
          <p className="font-medium">
            Goal: don't explain Amari. Give them a 3-step plan where THEY are the hero.
          </p>
          <p>
            Most cold callers explain their modality, credentials, philosophy. The prospect tunes out because
            they're hearing about YOU, not about THEM. The fix: frame yourself as the guide who helps the
            coach solve the coach's frustration. The 3-step plan removes ambiguity about how the partnership
            actually works.
          </p>
          <Quote>
            "Here's how this works — it's really simple. <strong>One:</strong> when you spot a student who's
            stuck on a body thing you can't drill out of them, you send them to me.{' '}
            <strong>Two:</strong> I do the bodywork to unlock whatever's keeping them from doing what you're
            coaching. <strong>Three:</strong> they come back to you physically able to break through — and
            you look like the coach who actually got them there. Instead of losing students because their
            body wouldn't cooperate, you become the one who solves it for them."
          </Quote>
          <p className="font-medium pt-2">Avoid:</p>
          <p className="pl-3 text-amari-text-muted text-xs">
            "Network Spinal," "rebalancing," "somatic," "25 years of practice," any credentialing intro.
            None of that lands. The plan does.
          </p>
        </StepSection>

        <StepSection title="5. Book — calendar commitment on this call">
          <p className="font-medium">
            Goal: lock in the calendar now, not "I'll get back to you."
          </p>
          <p>
            If they leave without a time set, most won't follow up. The rule: book a meeting from a meeting.
          </p>
          <Quote>
            "Awesome. Let's get you on the calendar now so we don't lose momentum. Do mornings or afternoons
            work better?"
          </Quote>
          <p>Wait for answer. Then:</p>
          <Quote>
            "Perfect — I have [Tuesday at 9am] or [Thursday at 10:30am]. Which works better?"
          </Quote>
          <p className="font-medium pt-2">Why A/B beats open-ended:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>"When are you free?" → they scan their whole calendar → friction → "let me get back to you"</li>
            <li>"Tuesday 9 or Thursday 10:30?" → 1-second decision, no calendar scan</li>
          </ul>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Logistics ONLY after time is locked
            </h4>
            <Quote>
              "Tuesday at 9am it is. I'll send you the calendar invite now. The studio's at [address] —
              just wear something you can move in, you don't need to bring anything. We'll spend the first
              10 minutes talking about what your body's been doing, then we get on the table and do the
              work. You'll feel different walking out."
            </Quote>
            <p className="text-amari-text-muted pl-3 text-xs pt-2">
              Confirming logistics before the time is set overwhelms them and gives them a reason to stall.
            </p>
          </div>
        </StepSection>

        <StepSection title="6. Close the call">
          <Quote>
            "Great. Looking forward to [day/time]. Anything I should know before then?"
          </Quote>
          <p className="pt-2">
            That's it. Don't re-pitch. Don't over-thank. Don't say "feel free to call me if anything changes"
            (that's an out). Confirm, then hang up.
          </p>
        </StepSection>

        <StepSection title="Objection cheat sheet">
          <p>
            Don't argue. Don't logic. Mirror → label → calibrated question → no-oriented close. Slow, warm
            voice on all of these — fast or assertive delivery makes them feel manipulated.
          </p>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "I'll think about it."
            </h4>
            <p className="text-amari-text-muted text-xs">
              Translation: they feel pressured, don't see the value yet, or are trying to escape politely.
            </p>
            <ol className="list-decimal pl-5 space-y-1 pt-1">
              <li><strong>Mirror:</strong> <em>"Think about it?"</em> (silence, wait for them to elaborate)</li>
              <li><strong>Label:</strong> <em>"It sounds like there's a specific piece of this that doesn't quite sit right with you."</em></li>
              <li><strong>Calibrated:</strong> <em>"What's the biggest thing you'd be weighing?"</em></li>
              <li><strong>No-oriented close:</strong> <em>"Would it be a bad idea to put a tentative time on the calendar for next [day]? Gives you time to think — you can cancel if it's a no."</em></li>
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
              <li><strong>No-oriented close:</strong> <em>"Are you against just dropping a 10-minute placeholder on the calendar so we can see if what I send actually aligns?"</em></li>
            </ol>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              "We already have someone we refer to."
            </h4>
            <p className="text-amari-text-muted text-xs">
              Translation: change is scary — current provider is the safe choice. Don't attack the incumbent;
              praise their loyalty.
            </p>
            <ol className="list-decimal pl-5 space-y-1 pt-1">
              <li><strong>Mirror:</strong> <em>"Someone you already refer to?"</em></li>
              <li><strong>Label:</strong> <em>"It sounds like you're loyal to the relationships you've built — that's how good practices run."</em></li>
              <li><strong>Calibrated:</strong> <em>"How are you handling the cases where your current person isn't quite the right fit?"</em> OR <em>"What's the biggest body thing they haven't been able to solve for you?"</em></li>
              <li><strong>No-oriented close:</strong> <em>"Would it be ridiculous to do a brief session anyway, just so you know what I do for cases when your current person is booked or it's not their lane?"</em></li>
            </ol>
          </div>
        </StepSection>

        <StepSection title="Post-call">
          <p>Within 2 minutes of hanging up:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Log the outcome in <code>/staff/outreach</code> — <strong>Talked</strong> (and tick session-booked if applicable)</li>
            <li>Add a note with any specific student type or pain point they mentioned (so you can reference it when they walk in for the session)</li>
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
