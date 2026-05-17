// Discovery Call playbook — Garrett-facing reference for in-call lookup.
// Mirrors amari/strategy/Discovery Call.md. When the doc changes, update both.

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

export default function PlaybookPage() {
  return (
    <div className="px-4 pt-4 pb-8 max-w-2xl mx-auto">
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

      <section className="staff-card mb-4">
        <h2 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">Time blocking</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-amari-border">
              <th className="text-left py-1.5 pr-3 font-semibold text-amari-charcoal w-16">Min</th>
              <th className="text-left py-1.5 font-semibold text-amari-charcoal">Step</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">0–1</td>
              <td className="py-2">Frame: <em>"Tell me what's going on. I'll listen, then tell you what I think and what I'd recommend."</em></td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">1–6</td>
              <td className="py-2">They talk. Listen. Take notes.</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">6–8</td>
              <td className="py-2">Up to 3 clarifying questions</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">8–10</td>
              <td className="py-2">Reflect with specifics</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">10–12</td>
              <td className="py-2">Diagnose + reframe</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">12–14</td>
              <td className="py-2">Recommend one tier, offer 2 slots, book</td>
            </tr>
            <tr>
              <td className="py-2 pr-3 text-amari-text-muted">14–15</td>
              <td className="py-2">Confirm, send forms, hang up</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="space-y-3">
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
          <p className="font-medium">Do:</p>
          <Quote>
            "Based on what you've told me — [one-sentence reflection] — what I'd recommend is{' '}
            <strong>[tier]</strong>. The reason is [tie to their gap]. I've got [day at time] or [day at
            time]. Which works?"
          </Quote>
          <p className="font-medium">Example:</p>
          <Quote>
            "Based on what you've told me — 8 months in, PT didn't hold, getting in the way of stuff you care
            about — what I'd recommend is the 8-session series. Your body's held this imbalance for a while,
            and bringing it back takes enough sessions to actually re-learn. Tuesday at 2 or Thursday at 11.
            Which works?"
          </Quote>

          <div className="pt-3">
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
            <p>
              <strong>Initial $225:</strong> Book in GHL during the call.{' '}
              <em>"When you arrive on Tuesday I'll hand you an iPad — sign the policies, pay, then we work.
              Takes 5 minutes."</em>
            </p>
            <p className="mt-3">
              <strong>4-pack $720 / 8-pack $1,295: pay on the call.</strong>
            </p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Book the appointment in GHL during the call.</li>
              <li>From the client's page here, tap "Send 4-Pack" or "Send 8-Pack."</li>
              <li>Stay on the line. Walk them through paying.</li>
              <li>Confirm payment came through.</li>
              <li>Tell them what session 1 looks like.</li>
            </ol>
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
              "Of course. Let me hold Tuesday at 2 — if you decide by tomorrow evening it's yours. If not I
              release it. That way you don't lose the slot while you think."
            </Quote>
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
            <Quote>
              "It is. You've already spent [PT / MRIs / copays / time]. This is the conversation about
              whether we change the pattern or keep paying to manage the symptom."
            </Quote>
            <p className="font-medium pt-2">"My doctor said I need surgery."</p>
            <Quote>
              "Take that seriously. Surgery treats the structure. What's driving the structure to fail is
              usually a pattern. Work on the pattern for a few sessions — if it improves, you've avoided
              something irreversible. If not, surgery is still there."
            </Quote>
          </div>
        </StepSection>
      </div>
    </div>
  );
}
