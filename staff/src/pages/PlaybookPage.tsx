import { useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import discoveryMd from '@/content/playbooks/discovery-call.md?raw';
import partnerMd from '@/content/playbooks/partner-call.md?raw';
import therapistMd from '@/content/playbooks/therapist-call.md?raw';
import positioningMd from '@/content/playbooks/amari-practice-positioning-v2.md?raw';

// Garrett-facing playbooks for in-call lookup.
// Source markdown lives in src/content/playbooks/*.md.
// Canonical originals also kept in docs repo at amari/strategy/*.md — keep them in sync.

type Section = { title: string; body: string };

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function parsePlaybook(md: string): { intro: string; sections: Section[] } {
  const stripped = stripFrontmatter(md);
  const parts = stripped.split(/^## /m);
  const intro = parts[0]
    .replace(/\n---\s*\n/g, '\n')
    .split(/\n\*\*About v[\d.]+\.\*\*/)[0]
    .trim();
  const sections: Section[] = parts.slice(1).map((part) => {
    const newlineIdx = part.indexOf('\n');
    const title = part.slice(0, newlineIdx).trim();
    const body = part
      .slice(newlineIdx + 1)
      .replace(/\n---\s*\n?/g, '\n')
      .trim();
    return { title, body };
  });
  return { intro, sections };
}

// Quote = the line Garrett actually says on the call. Bigger, white-card lift,
// scannable mid-call. Notes around it recede by contrast.
const sectionComponents: Components = {
  blockquote: ({ children }) => (
    <blockquote className="my-3 p-3.5 bg-white border-l-4 border-amari-accent-warm rounded-r shadow-sm text-amari-charcoal text-base leading-relaxed font-medium">
      {children}
    </blockquote>
  ),
  p: ({ children }) => <p className="my-2">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 my-2">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  table: ({ children }) => (
    <div className="my-3 -mx-1 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody className="align-top">{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-amari-border/40">{children}</tr>,
  th: ({ children }) => (
    <th className="text-left py-1.5 pr-3 font-semibold text-amari-charcoal border-b border-amari-border">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="py-2 pr-3">{children}</td>,
  h3: ({ children }) => (
    <h4 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mt-4 mb-2">
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mt-3 mb-1">
      {children}
    </h5>
  ),
  hr: () => <hr className="my-4 border-amari-border/40" />,
  strong: ({ children }) => <strong className="font-semibold text-amari-charcoal">{children}</strong>,
  em: ({ children }) => <>{children}</>,
};

const introComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-serif text-amari-charcoal mb-2">{children}</h1>
  ),
  p: ({ children }) => (
    <p className="text-sm text-amari-charcoal/80 leading-relaxed">{children}</p>
  ),
  hr: () => null,
};

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
      <div className="px-4 pb-4 pt-1 text-sm text-amari-charcoal/90 leading-relaxed border-t border-amari-border/60">
        {children}
      </div>
    </details>
  );
}

function PlaybookContent({ md }: { md: string }) {
  const { intro, sections } = useMemo(() => parsePlaybook(md), [md]);
  return (
    <>
      <header className="mb-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={introComponents}>
          {intro}
        </ReactMarkdown>
      </header>
      <div className="space-y-3">
        {sections.map((sec, i) => (
          <StepSection key={`${sec.title}-${i}`} title={sec.title}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={sectionComponents}>
              {sec.body}
            </ReactMarkdown>
          </StepSection>
        ))}
      </div>
    </>
  );
}

export type PlaybookTab = 'discovery' | 'partner' | 'therapist' | 'positioning';

export default function PlaybookPage({
  embedded = false,
  activeTab,
  onTabChange,
}: {
  embedded?: boolean;
  activeTab?: PlaybookTab;
  onTabChange?: (tab: PlaybookTab) => void;
}) {
  const [internalTab, setInternalTab] = useState<PlaybookTab>('discovery');
  const tab = activeTab ?? internalTab;
  const chooseTab = onTabChange ?? setInternalTab;

  const tabClass = (active: boolean) =>
    `flex-1 py-2.5 px-3 text-sm font-medium rounded-md transition-colors min-h-[40px] ${
      active
        ? 'bg-white text-amari-charcoal shadow-sm'
        : 'text-amari-text-muted hover:text-amari-charcoal'
    }`;

  return (
    <div className={embedded ? 'training-playbooks' : 'px-4 pt-4 pb-8 max-w-2xl mx-auto'}>
      <div className={embedded ? 'training-playbooks__tabs' : 'sticky top-0 -mx-4 px-4 py-2 bg-amari-light-sand/95 backdrop-blur z-10 mb-3'}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-amari-border/30 rounded-lg">
          <button onClick={() => chooseTab('discovery')} className={tabClass(tab === 'discovery')}>
            Discovery Call
          </button>
          <button onClick={() => chooseTab('partner')} className={tabClass(tab === 'partner')}>
            Partner Call
          </button>
          <button onClick={() => chooseTab('therapist')} className={tabClass(tab === 'therapist')}>
            Therapist Call
          </button>
          <button onClick={() => chooseTab('positioning')} className={tabClass(tab === 'positioning')}>
            Positioning V2
          </button>
        </div>
      </div>

      {tab === 'discovery' && <PlaybookContent md={discoveryMd} />}
      {tab === 'partner' && <PlaybookContent md={partnerMd} />}
      {tab === 'therapist' && <PlaybookContent md={therapistMd} />}
      {tab === 'positioning' && <PlaybookContent md={positioningMd} />}
    </div>
  );
}
