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
        <p className="text-sm text-amari-charcoal/80 leading-relaxed mb-2">
          15-minute call. Your job is to recommend a session or series and book it.
        </p>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed mb-2">
          The form is a consult — listen, diagnose, recommend. The outcome is a sale. Both
          things are true at once. The consultative form is <em>how</em> you sell; it isn't a
          substitute for selling.
        </p>
        <p className="text-sm text-amari-charcoal/80 leading-relaxed">
          The caller already has a problem they can name ("my back has hurt for 6 months," "my
          doctor says I need knee surgery"). They booked to find someone who can credibly tell
          them what to do. Your job is to be that person, and to book them on the call.
        </p>
      </header>

      {/* Intent — always visible */}
      <section className="staff-card mb-3">
        <h2 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
          Intent
        </h2>
        <p className="text-sm text-amari-charcoal/90 leading-relaxed mb-2">
          The goal of every call is to recommend a tier and book it.
        </p>
        <p className="text-sm text-amari-charcoal/90 leading-relaxed mb-3">
          Recommending isn't pressure. The caller is in pain, the work helps, and a confident
          recommendation is what they came for. The bigger risk is under-recommending.
        </p>
        <ul className="text-sm text-amari-charcoal/90 leading-relaxed space-y-1 pl-1">
          <li>
            <strong>Listen</strong> → they need to feel heard before they trust a recommendation
          </li>
          <li>
            <strong>Reflect</strong> → proves you understood, earns the right to diagnose
          </li>
          <li>
            <strong>Diagnose + reframe</strong> → distinguishes the work from what they've tried, justifies the price
          </li>
          <li>
            <strong>Recommend + book</strong> → the close
          </li>
        </ul>
      </section>

      {/* Time blocking — always visible */}
      <section className="staff-card mb-4">
        <h2 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
          Time blocking
        </h2>
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
              <td className="py-2">
                Frame: <em>"Tell me what's going on. I'll listen, then tell you what I think and what I'd recommend."</em>
              </td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">1–6</td>
              <td className="py-2">They talk. Listen. Do not interrupt. Take notes.</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">6–8</td>
              <td className="py-2">Up to 3 clarifying questions.</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">8–10</td>
              <td className="py-2">Reflect their pain back to them with specifics.</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">10–12</td>
              <td className="py-2">Diagnose + reframe what they've been told.</td>
            </tr>
            <tr className="border-b border-amari-border/40">
              <td className="py-2 pr-3 text-amari-text-muted">12–14</td>
              <td className="py-2">Recommend one tier, offer two specific time slots, book.</td>
            </tr>
            <tr>
              <td className="py-2 pr-3 text-amari-text-muted">14–15</td>
              <td className="py-2">Confirm, send forms, hang up.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="space-y-3">
        {/* 1. Listen */}
        <StepSection title="1. Listen (1–6 min)">
          <p>Do not interrupt. Take notes on:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Exact body parts ("right knee," "between the shoulder blades")</li>
            <li>Duration ("6 months," "since my kid was born")</li>
            <li>What they've tried + why it stopped helping</li>
            <li>Functional impact ("can't sit through meetings," "can't sleep on my side")</li>
            <li>Emotional words they use ("scared," "fed up," "hopeless")</li>
          </ul>
          <p>
            Permissible interjections: <em>"Keep going."</em> <em>"Tell me more about that."</em>{' '}
            <em>"And then what happened?"</em>
          </p>
          <p className="font-medium pt-2">After they finish, ask up to 3 clarifiers:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              <strong>Timing.</strong> "When does it hurt — morning, after activity, end of day, or constantly?"
            </li>
            <li>
              <strong>What's been tried.</strong> "What have you tried, and what shifted vs what didn't?" (skip if covered)
            </li>
            <li>
              <strong>Why now.</strong> "Why is now the moment you decided to do something about it?"
            </li>
          </ol>
          <p className="text-amari-text-muted">Stop at 3. More questions feel like an intake form.</p>
        </StepSection>

        {/* 2. Reflect */}
        <StepSection title="2. Reflect (8–10 min)">
          <p>
            Mirror their specifics back. This is the step most likely to get skipped, and skipping
            it is the main reason callers don't buy — they don't trust a recommendation from
            someone who hasn't proven they heard the problem.
          </p>
          <p className="font-medium">Format:</p>
          <Quote>
            "OK so what I'm hearing is — [body part / duration] → [what they've tried + why it
            failed] → [functional impact] → [why now]. Is that about right?"
          </Quote>
          <p className="font-medium">Example.</p>
          <p>
            If they said <em>"my lower back's been killing me for 8 months, I've done PT twice,
            helps for a week then comes back, my GP wants an MRI, I can't pick up my kid":</em>
          </p>
          <Quote>
            "OK so what I'm hearing is — 8 months of lower back pain, PT helped briefly but didn't
            hold, you're looking at maybe an MRI next, and it's affecting things you care about
            like picking up your kid. Is that about right?"
          </Quote>
          <p>
            It also lets them correct anything you got wrong, and they often add a critical detail here.
          </p>
          <p className="font-medium pt-2">Don't:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Summarize abstractly ("So you have back pain"). Use their specifics.</li>
            <li>Add interpretation yet ("Sounds like a hip issue"). That comes next.</li>
            <li>Say "I hear you." Empty phrase. The reflection is the evidence.</li>
            <li>
              Skip ahead to "here's what Amari is..." — they didn't book to hear about Amari. The
              Amari frame comes in the next step, in 30 seconds, after the diagnosis.
            </li>
          </ul>
        </StepSection>

        {/* 3. Diagnose + reframe */}
        <StepSection title="3. Diagnose + reframe (10–12 min)">
          <p>Tie everything to what they just said. No generic "here's what Amari is."</p>
          <p className="font-medium">The underlying frame (your words, use the pieces that fit):</p>
          <Quote>
            "Your body is a suspension bridge. Every part is designed to hold the load equally.
            When one part is doing too much and another part isn't doing enough, the part doing
            too much is where the pain shows up. The body isn't asking for surgery or steroid
            injections or stretching — it's asking for balance."
          </Quote>
          <p className="font-medium">Format:</p>
          <Quote>
            "Here's what I think is going on. [Specific explanation of where they're out of
            balance — what's overworking, what isn't doing its share]. The reason [thing they
            tried] didn't hold is [explanation]. That doesn't mean you're broken — it means
            [reframe]."
          </Quote>
          <p className="font-medium pt-1">Reframes by what they've been told:</p>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "You need surgery."
              </p>
              <Quote>
                "Surgery makes sense in true emergencies — arm falling off after a car accident.
                Most of what people get surgery for isn't that. It's a body that's out of
                balance, and surgery is treating it biomechanically — like putting a plastic bag
                where the window should be. Worth seeing if balance changes the picture before
                you do something irreversible."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "PT helped, then stopped."
              </p>
              <Quote>
                "PT is muscular based — it loads the area that hurts and tries to strengthen it.
                What it doesn't look at is how the whole body is sharing the load. Strengthening
                a part that's already overworking just trains the imbalance harder. That's why
                the relief was temporary."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "Just stretch it / do more core work."
              </p>
              <Quote>
                "Stretching is only half the story. When you're out of balance, the part that
                feels tight is overworking because something else isn't doing its share. Stretch
                the tight part and you've ignored the other half. We find what isn't engaged and
                bring it back online — then the tight part lets go on its own."
              </Quote>
            </div>
            <div>
              <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
                "I've done chiro and it didn't hold."
              </p>
              <Quote>
                "Most chiropractic is something done <em>to</em> you — you lay on a table
                passively while someone forces the structure. That can give relief, but your body
                didn't learn anything. The minute you walk out, your imbalance pulls you right
                back. We have you do the work, so your body actually learns to hold the new
                balance."
              </Quote>
            </div>
          </div>

          <p className="font-medium pt-2">Then 30 seconds on what you actually do:</p>
          <Quote>
            "I teach you a small set of protocols — 8 in total, but most people only need 3 or 4
            for what their body needs. They bring your body back into balance, every part
            sharing the load the way it's designed to. Most clients feel a meaningful shift in
            the first session. Then we refine it over a series so your body holds onto it."
          </Quote>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Timeline language
            </h4>
            <p>
              Your honest model is that bringing the body back into balance is a multi-month
              process — three to six months for the real work, with shifts starting earlier.
              That's accurate and valuable. The trap is how it gets phrased.
            </p>
            <p className="mt-2">
              <strong>The phrase that doesn't land:</strong>{' '}
              <em>"It takes months to learn anything."</em>
            </p>
            <p className="mt-1">
              The problem isn't <em>months.</em> It's <em>learn</em> (sounds like the prospect
              is a slow student) and <em>anything</em> (sounds like nothing happens for months).
              Both deflate.
            </p>
            <p className="font-medium mt-3">Lead with the short-term shift, then frame the longer arc:</p>
            <Quote>
              "You'll start feeling shifts in your first session. The real work happens over the
              next few months as your body learns to hold the new balance without me. That's why
              I work in series, not one-offs."
            </Quote>
            <Quote>
              "This isn't a one-and-done fix — we work over a few months. You notice changes from
              session one, but the goal is balance that holds on its own. That takes the time it
              takes."
            </Quote>
            <Quote>
              "Short term, you'll feel shifts. Long term, we're after balance — and balance takes
              a few months for your body to actually hold."
            </Quote>
            <p className="text-amari-text-muted mt-2">
              The frame: shifts start immediately, balance is the multi-month goal.
            </p>
          </div>
        </StepSection>

        {/* 4. Recommend + book */}
        <StepSection title="4. Recommend + book (12–14 min)">
          <p>
            This is the close. The previous 12 minutes earned you the right to make a clear
            recommendation; this is where you make it.
          </p>
          <p>
            The default ask <em>"do you want to book your first session?"</em> isn't a
            recommendation — it hands the choice back to the caller. The format below makes the
            recommendation for them and defaults the logistics.
          </p>
          <p className="font-medium">Format:</p>
          <Quote>
            "Based on what you've told me — [one-sentence reflection] — what I'd recommend is{' '}
            <strong>[tier]</strong>. The reason is [tie to their gap]. I've got [day at time] or
            [day at time] this week. Which works better?"
          </Quote>
          <p className="font-medium">Example:</p>
          <Quote>
            "Based on what you've told me — 8 months in, PT didn't hold, getting in the way of
            stuff you care about — what I'd recommend is starting with the 8-session series.
            Your body's been holding this imbalance for a while, and bringing it back takes
            enough sessions for your body to actually re-learn the new way of holding itself.
            I've got Tuesday at 2 or Thursday at 11 this week. Which works better?"
          </Quote>

          <div className="pt-3">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Which tier to recommend
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
                  <td className="py-2 pr-3">Acute, recent, otherwise healthy</td>
                  <td className="py-2 font-medium">Initial $225</td>
                </tr>
                <tr className="border-b border-amari-border/40">
                  <td className="py-2 pr-3">Chronic but localized, one body part</td>
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
            <p className="text-amari-text-muted mt-2">
              Pick one tier. Recommend it. Do not lay all three out as a menu.
            </p>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              How to actually book it
            </h4>
            <p>
              Every step between "yes" and "money received" is a place the sale can leak. The
              right mechanics depend on the tier — buying temperature decays fast, and for the
              bigger packages, hours between "yes" and "paid" cost real conversions.
            </p>
            <p className="font-medium mt-3">For Initial $225 — book now, pay at session 1:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Book the appointment in GHL while on the call. Confirm the slot back to them.</li>
              <li>
                Tell them what happens at session 1: <em>"When you arrive on Tuesday I'll hand you
                an iPad — you'll sign the practice policies, pay for the session, and then we get
                to work. Takes about 5 minutes."</em>
              </li>
            </ol>
            <p className="font-medium mt-3">For 4-pack $720 or 8-pack $1,295 — pay on the call.</p>
            <p>
              The doubt window between verbal yes and paid is the difference between a converted
              sale and a cancelled one for the bigger packages. Get the money while you're still on
              the line.
            </p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Book the appointment in GHL while on the call.</li>
              <li>From the client's page in this app, tap "Send 8-Pack" or "Send 4-Pack."</li>
              <li>Stay on the line. Walk them through paying.</li>
              <li>Confirm payment came through.</li>
              <li>Tell them what happens at session 1 (sign policies on iPad, then work).</li>
            </ol>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Sending the pay link — script
            </h4>
            <p className="font-medium">Frame it before you send:</p>
            <Quote>
              "Great — let's get you locked in. I'm going to text you the payment link right now.
              Takes about 30 seconds — you should be able to Apple Pay it. I'll stay on the line
              with you."
            </Quote>
            <p className="font-medium">Tap the button to send.</p>
            <p className="font-medium">Narrate while they tap (fills the silence where doubt creeps in):</p>
            <Quote>
              "Got the text? Cool, tap that link — that's our Stripe page, totally secure. Yep,
              you can Face ID it..."
            </Quote>
            <p className="font-medium">When payment confirms, immediately reaffirm:</p>
            <Quote>
              "Got the confirmation on my end. You're in for Tuesday at 2. Glad we're doing
              this — looking forward to working with you."
            </Quote>
            <p className="font-medium pt-2">Rules:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Don't reach for the pay link until you've heard a clear verbal yes. Sending it to
                break a "maybe" reads as pressure.
              </li>
              <li>Don't hang up before payment confirms. The call IS the close container.</li>
              <li>Don't go silent while they're paying. Narrate gently.</li>
              <li>
                Post-payment silence is when buyer's remorse spikes — fill it with confirmation
                and warmth, then hang up.
              </li>
            </ul>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Handling push-back
            </h4>
            <p className="font-medium">"Can we just start with one?"</p>
            <Quote>
              "Yes, absolutely. Most people in your situation end up wanting the series after the
              first one — so know the $225 applies as credit toward a series if you convert."
            </Quote>
            <p className="font-medium pt-2">"Let me think about it."</p>
            <Quote>
              "Of course. Let me hold Tuesday at 2 for you — if you decide by tomorrow evening
              you want it, it's yours. If not I'll release it. That way you don't lose the slot
              while you think. Sound fair?"
            </Quote>
          </div>

          <div className="pt-3 mt-3 border-t border-amari-border/60">
            <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
              Top 5 objections
            </h4>
            <p className="font-medium">"I've tried everything, why would this be different?"</p>
            <Quote>
              "Everything you've tried treated the area that hurts. We work on what's pulling the
              area into pain. That's why it holds. If no one's worked on the pattern instead of
              the symptom, that's the variable that hasn't been tested."
            </Quote>
            <p className="font-medium pt-2">"How do I know this will work for me?"</p>
            <Quote>
              "I don't make guarantees. What I can tell you is most clients feel a real shift in
              the first session. If you don't, we have a conversation about whether to keep
              going. I'm not interested in selling you something that's not working for your
              body."
            </Quote>
            <p className="font-medium pt-2">"It's a lot of money."</p>
            <Quote>
              "It is. You've already spent [reference what they mentioned — PT, MRIs, copays,
              time]. This is the conversation about whether we change the pattern or keep paying
              to manage the symptom."
            </Quote>
            <p className="font-medium pt-2">"Can I just do one session to try it?"</p>
            <Quote>
              "Yes. Most people in your situation end up wanting the series after the first
              one, so know the $225 applies toward whatever pack you choose."
            </Quote>
            <p className="font-medium pt-2">"My doctor said I need surgery."</p>
            <Quote>
              "Take that seriously. Surgery treats the structure. What's driving the structure
              to fail is usually a pattern. If we work on the pattern for a few sessions and the
              structure improves, you've avoided something irreversible. If it doesn't, surgery
              is still there."
            </Quote>
          </div>
        </StepSection>
      </div>
    </div>
  );
}
