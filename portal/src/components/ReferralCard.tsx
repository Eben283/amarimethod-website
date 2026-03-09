import { useState } from 'react';
import { Users, Gift, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

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
    // Fallback for older browsers
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

  const handleCopyLink = async () => {
    await copyText(referralLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleCopyCode = async () => {
    if (!rewardCode) return;
    await copyText(rewardCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleCopyMessage = async () => {
    const message = `I've been seeing a practitioner who's really helped me — here's a link to book your first session: ${referralLink}`;
    await copyText(message);
    setMessageCopied(true);
    setTimeout(() => setMessageCopied(false), 2000);
  };

  return (
    <div className="portal-card">

      {/* ── Collapsed header — always visible ── */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-start gap-4 w-full text-left"
        aria-expanded={isExpanded}
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-light-sand text-amari-charcoal">
          {hasReachedMilestone && rewardCode
            ? <Gift className="w-5 h-5" />
            : <Users className="w-5 h-5" />
          }
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-sans font-semibold text-amari-charcoal text-sm">
            {hasReachedMilestone && rewardCode ? 'Your free session is ready.' : 'Give a Session. Get a Session.'}
          </h3>
          <p className="text-xs text-amari-text-muted mt-0.5">
            {hasReachedMilestone
              ? rewardCode
                ? `Code: ${rewardCode} — tap to expand`
                : 'Milestone reached — reward on the way'
              : referralCount === 0
                ? `Refer ${MILESTONE} friends who book — earn a free session`
                : `${referralCount} of ${MILESTONE} referrals complete · ${MILESTONE - referralCount} more to go`
            }
          </p>
        </div>

        <div className="flex-shrink-0 self-center text-amari-text-muted">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* ── Expanded content ── */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-amari-border space-y-5">

          {/* 3 circle indicators */}
          <div>
            <p className="text-xs text-amari-text-muted mb-2">
              {hasReachedMilestone
                ? 'You\'ve reached the milestone — enjoy your free session!'
                : `${MILESTONE - Math.min(referralCount, MILESTONE)} more paid referral${MILESTONE - Math.min(referralCount, MILESTONE) !== 1 ? 's' : ''} to earn a free session`
              }
            </p>
            <div className="flex items-center gap-4">
              {Array.from({ length: MILESTONE }).map((_, i) => {
                const isFilled = i < referralCount;
                return (
                  <div
                    key={i}
                    className={`w-11 h-11 transition-all ${isFilled ? 'opacity-100' : 'opacity-20'}`}
                    aria-label={isFilled ? `Referral ${i + 1} — complete` : `Referral ${i + 1} — pending`}
                  >
                    <img
                      src="/images/amari-icon.png"
                      alt=""
                      className="w-full h-full"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reward coupon — shown after milestone */}
          {hasReachedMilestone && rewardCode && (
            <div className="p-3 bg-amari-light-sand rounded-lg">
              <p className="text-xs text-amari-text-muted mb-1 font-semibold uppercase tracking-widest">
                Your free session code
              </p>
              <div className="flex items-center gap-3">
                <span className="font-sans font-bold text-amari-charcoal text-lg tracking-widest flex-1">
                  {rewardCode}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="portal-btn-secondary flex items-center gap-1.5 text-xs"
                >
                  {codeCopied
                    ? <><Check className="w-3.5 h-3.5" /> Copied!</>
                    : <><Copy className="w-3.5 h-3.5" /> Copy</>
                  }
                </button>
              </div>
              <p className="text-xs text-amari-text-muted mt-2 leading-relaxed">
                Enter this code at checkout when booking your next session.
              </p>
            </div>
          )}

          {/* Referral link */}
          <div>
            <p className="text-xs text-amari-text-muted mb-1.5">Your invite link</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-amari-charcoal bg-amari-light-sand px-2.5 py-1.5 rounded flex-1 truncate font-mono min-w-0">
                {referralLink}
              </span>
              <button
                onClick={handleCopyLink}
                className="portal-btn-secondary flex items-center gap-1.5 text-xs flex-shrink-0"
              >
                {linkCopied
                  ? <><Check className="w-3.5 h-3.5" /> Copied!</>
                  : <><Copy className="w-3.5 h-3.5" /> Copy</>
                }
              </button>
            </div>
          </div>

          {/* Pre-written message */}
          <div>
            <p className="text-xs text-amari-text-muted mb-1.5">Share this with a friend</p>
            <div className="bg-amari-light-sand rounded-lg p-3">
              <p className="text-xs text-amari-charcoal leading-relaxed italic">
                "I've been seeing a practitioner who's really helped me — here's a link to book your first session:"
              </p>
              <p className="text-xs text-amari-text-muted mt-1 truncate">{referralLink}</p>
            </div>
            <button
              onClick={handleCopyMessage}
              className="portal-btn-secondary flex items-center gap-1.5 text-xs mt-2"
            >
              {messageCopied
                ? <><Check className="w-3.5 h-3.5" /> Message copied!</>
                : <><Copy className="w-3.5 h-3.5" /> Copy message</>
              }
            </button>
          </div>

          {/* How it works */}
          <p className="text-xs text-amari-text-muted leading-relaxed">
            When a friend books and pays for their first session using your link, it counts toward your free session. One referral credit per person.
          </p>

        </div>
      )}
    </div>
  );
}
