import { useState } from 'react';

interface ReferralCardProps {
  contactId: string;
  referralCount: number;
  rewardCode: string | null;
}

const INVITE_BASE = 'https://www.amarimethod.com/invite?ref=';
const MILESTONE = 3;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

export default function ReferralCard({ contactId, referralCount, rewardCode }: ReferralCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);

  const referralLink = `${INVITE_BASE}${contactId}`;
  const hasReachedMilestone = referralCount >= MILESTONE;
  const remaining = Math.max(0, MILESTONE - referralCount);

  async function handleCopyLink() {
    await copyText(referralLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }
  async function handleCopyCode() {
    if (!rewardCode) return;
    await copyText(rewardCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }
  async function handleCopyMessage() {
    const msg = `I've been seeing a practitioner who's really helped me — here's a link to book your first session: ${referralLink}`;
    await copyText(msg);
    setMessageCopied(true);
    setTimeout(() => setMessageCopied(false), 2000);
  }

  return (
    <section className="cp-ref" data-testid="referral-card">
      <button
        type="button"
        className="cp-ref-summary"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className="cp-ref-summary-l">
          <span className="cp-mono">{hasReachedMilestone ? 'Reward ready' : 'Refer & earn'}</span>
          <h3 className="cp-ref-title">
            {hasReachedMilestone && rewardCode
              ? <>Your free session is ready.</>
              : <>Give a session, get a session.</>}
          </h3>
        </div>
        <div className="cp-ref-summary-r">
          <div className="cp-ref-pips">
            {Array.from({ length: MILESTONE }).map((_, i) => (
              <span key={i} className={'cp-ref-pip' + (i < referralCount ? ' is-filled' : '')} aria-hidden="true" />
            ))}
          </div>
          <span className="cp-ref-chev">{isExpanded ? '–' : '+'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="cp-ref-body">
          <p className="cp-ref-prose">
            {hasReachedMilestone
              ? "You hit the milestone. Use the code below for your free session."
              : `${remaining} more paid referral${remaining === 1 ? '' : 's'} earns a free session for you.`}
          </p>

          {hasReachedMilestone && rewardCode && (
            <div className="cp-ref-block">
              <span className="cp-mono">Your free session code</span>
              <div className="cp-ref-code-row">
                <code className="cp-ref-code">{rewardCode}</code>
                <button type="button" className="cp-btn cp-btn-ghost cp-btn-row" onClick={handleCopyCode}>
                  {codeCopied ? 'Copied' : 'Copy code'}
                </button>
              </div>
              <p className="cp-ref-fine">Enter this at checkout when booking your next session.</p>
            </div>
          )}

          <div className="cp-ref-block">
            <span className="cp-mono">Your invite link</span>
            <div className="cp-ref-link-row">
              <span className="cp-ref-link">{referralLink}</span>
              <button type="button" className="cp-btn cp-btn-ghost cp-btn-row" onClick={handleCopyLink}>
                {linkCopied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>

          <div className="cp-ref-block">
            <span className="cp-mono">Or send this message</span>
            <p className="cp-ref-message">
              "I've been seeing a practitioner who's really helped me — here's a link to book your first session: <span className="cp-ref-message-url">{referralLink}</span>"
            </p>
            <button type="button" className="cp-btn cp-btn-ghost cp-btn-row" onClick={handleCopyMessage}>
              {messageCopied ? 'Copied' : 'Copy message'}
            </button>
          </div>

          <p className="cp-ref-fine">
            When a friend books and pays for their first session using your link, it counts toward your free session. One credit per person.
          </p>
        </div>
      )}
    </section>
  );
}
