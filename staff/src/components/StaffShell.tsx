import {
  Activity,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ClipboardPlus,
  GitBranch,
  House,
  ListChecks,
  Loader2,
  LogOut,
  MapPinned,
  Menu,
  MessageSquareText,
  Images,
  Palette,
  Package,
  BellRing,
  Search,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  UsersRound,
  WalletCards,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getConversations, getOpsSystemsBoard, searchContacts } from '../lib/api';
import type { ContactListItem } from '../types/staff';
import '../styles/staff-shell.css';

type RailItem = {
  label: string;
  shortLabel?: string;
  detail: string;
  to: string;
  Icon: LucideIcon;
  badge?: 'inbox' | 'operations';
  matches?: (pathname: string) => boolean;
};

type ShellCounts = {
  inbox: number | null;
  operations: number | null;
};

const PRIMARY_ITEMS: RailItem[] = [
  { label: 'Home', detail: 'Your practice day', to: '/', Icon: House, matches: (path) => path === '/' },
  { label: 'Calendar', detail: 'Day, week, month and services', to: '/calendar', Icon: CalendarDays, matches: (path) => path === '/calendar' || path === '/today' },
  { label: 'Inbox', detail: 'Member communication', to: '/client-desk', Icon: MessageSquareText, badge: 'inbox', matches: (path) => path === '/client-desk' || path === '/messages' },
  { label: 'Practice members', shortLabel: 'Members', detail: 'People and records', to: '/clients', Icon: UsersRound, matches: (path) => path === '/clients' || path.startsWith('/client/') },
  { label: 'Follow-up', detail: 'Replies and next moves', to: '/follow-up', Icon: ListChecks },
  { label: 'Money', detail: 'Balances and payment work', to: '/balances', Icon: WalletCards, matches: (path) => path === '/balances' || path === '/revenue' || path === '/products' || path.startsWith('/products/') || path === '/pos' },
  { label: 'Pipeline', detail: 'Care flow', to: '/pipeline', Icon: GitBranch, matches: (path) => path === '/pipeline' || path === '/funnel' },
  { label: 'Operations', detail: 'System health and cutover checks', to: '/operations', Icon: Activity, badge: 'operations' },
];

const SPECIALIST_ITEMS: RailItem[] = [
  { label: 'Revenue', detail: 'Stripe sales record', to: '/revenue', Icon: CircleDollarSign },
  { label: 'Products', detail: 'Offers and sale items', to: '/products', Icon: Package },
  { label: 'Media library', detail: 'Shared files and images', to: '/media', Icon: Images },
  { label: 'Design system', detail: 'Brand and collateral reference', to: '/design-system', Icon: Palette },
  { label: 'Staff POS', detail: 'In-person checkout', to: '/pos', Icon: ShoppingBag },
  { label: 'Funnel', detail: 'Lead flow and pace', to: '/funnel', Icon: TrendingUp },
  { label: 'Community', detail: 'Field relationships', to: '/community', Icon: MapPinned },
  { label: 'Automations', detail: 'What runs and why', to: '/automations', Icon: Workflow },
  { label: 'Playbooks', detail: 'Practice reference', to: '/playbook', Icon: BookOpen },
  { label: 'Ask Amari', detail: 'Chief of Staff', to: '/cos', Icon: Sparkles },
  { label: 'Field Studies', detail: 'Specialist study records', to: '/field-studies', Icon: ClipboardPlus },
];

const SETTINGS_ITEM: RailItem = {
  label: 'Notifications',
  detail: 'Team communication preferences',
  to: '/settings/communication',
  Icon: BellRing,
};

function itemIsActive(item: RailItem, pathname: string) {
  if (item.matches) return item.matches(pathname);
  return pathname === item.to || (item.to !== '/' && pathname.startsWith(`${item.to}/`));
}

function itemIsCurrent(item: RailItem, pathname: string) {
  if (pathname === item.to) return true;
  return item.to === '/clients' && pathname.startsWith('/client/');
}

function useCompactLayout() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return compact;
}

function useShellCounts() {
  const [counts, setCounts] = useState<ShellCounts>({ inbox: null, operations: null });

  const refresh = useCallback(async () => {
    const [inbox, operations] = await Promise.allSettled([
      getConversations('unread'),
      getOpsSystemsBoard(),
    ]);
    setCounts((current) => ({
      inbox: inbox.status === 'fulfilled' ? inbox.value.total : current.inbox,
      operations: operations.status === 'fulfilled' ? operations.value.attentionCount : current.operations,
    }));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 120_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return counts;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

function MemberSearch({ inputRef, onChoose }: { inputRef: MutableRefObject<HTMLInputElement | null>; onChoose: () => void }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const id = ++requestId.current;
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(false);
    const timer = window.setTimeout(() => {
      void searchContacts(trimmed)
        .then((contacts) => {
          if (id !== requestId.current) return;
          setResults(contacts.slice(0, 7));
          setSearched(true);
        })
        .catch((error: unknown) => {
          if (id !== requestId.current) return;
          if (typeof error === 'object' && error && 'status' in error && error.status === 401) logout();
          setResults([]);
          setSearched(true);
        })
        .finally(() => { if (id === requestId.current) setLoading(false); });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [logout, query]);

  function choose(contact: ContactListItem) {
    setQuery('');
    setOpen(false);
    onChoose();
    navigate(`/client/${contact.id}`);
  }

  return (
    <div className="practice-search" onFocus={() => setOpen(true)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <label htmlFor="practice-member-search">Find a practice member</label>
      <div className="practice-search__field">
        <Search aria-hidden="true" />
        <input
          id="practice-member-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); inputRef.current?.blur(); } }}
          placeholder="Name, email, or phone"
          autoComplete="off"
          spellCheck={false}
        />
        {loading ? <Loader2 className="practice-search__spinner" aria-label="Searching" /> : null}
      </div>
      {open && query.trim().length >= 2 ? (
        <div className="practice-search__results" role="listbox" aria-label="Practice member search results">
          {searched && !loading && results.length === 0 ? <p>No practice members found.</p> : null}
          {results.map((contact) => (
            <button key={contact.id} type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(contact)}>
              <span className="practice-search__avatar" aria-hidden="true">{initials(contact.name)}</span>
              <span><strong>{contact.name || 'Unnamed contact'}</strong><small>{contact.phone || contact.email || 'Contact record'}</small></span>
            </button>
          ))}
          <NavLink to="/clients" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); onChoose(); }}>
            Open member search
          </NavLink>
        </div>
      ) : null}
    </div>
  );
}

function CountBadge({ kind, count }: { kind: 'inbox' | 'operations'; count: number | null }) {
  if (!count) return null;
  const label = kind === 'inbox'
    ? `${count} unread conversation${count === 1 ? '' : 's'}`
    : `${count} system${count === 1 ? '' : 's'} need attention`;
  return <span className={`practice-rail__badge practice-rail__badge--${kind}`} aria-label={label}>{count > 99 ? '99+' : count}</span>;
}

function RailLink({ item, count, onChoose }: { item: RailItem; count: number | null; onChoose: () => void }) {
  const { pathname } = useLocation();
  const active = itemIsActive(item, pathname);
  const current = itemIsCurrent(item, pathname);
  const { Icon } = item;
  return (
    <NavLink to={item.to} className={`practice-rail__link${active ? ' is-active' : ''}`} aria-current={current ? 'page' : undefined} onClick={onChoose}>
      <span className="practice-rail__marker" aria-hidden="true" />
      <Icon className="practice-rail__icon" aria-hidden="true" />
      <span className="practice-rail__copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
      {item.badge ? <CountBadge kind={item.badge} count={count} /> : null}
    </NavLink>
  );
}

export default function StaffShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const compact = useCompactLayout();
  const counts = useShellCounts();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isReferencePage = location.pathname.startsWith('/design-system');
  const [specialistsOpen, setSpecialistsOpen] = useState(() => SPECIALIST_ITEMS.some((item) => itemIsActive(item, location.pathname)));
  const railRef = useRef<HTMLElement>(null);
  const mobileHeadRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const currentItem = useMemo(
    () => SPECIALIST_ITEMS.find((item) => itemIsCurrent(item, location.pathname))
      || (itemIsActive(SETTINGS_ITEM, location.pathname) ? SETTINGS_ITEM : undefined)
      || PRIMARY_ITEMS.find((item) => itemIsActive(item, location.pathname)),
    [location.pathname],
  );

  useEffect(() => {
    setDrawerOpen(false);
    if (SPECIALIST_ITEMS.some((item) => itemIsActive(item, location.pathname))) setSpecialistsOpen(true);
  }, [location.pathname]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (compact && !drawerOpen) rail.setAttribute('inert', '');
    else rail.removeAttribute('inert');
    return () => rail.removeAttribute('inert');
  }, [compact, drawerOpen]);

  useEffect(() => {
    const background = [mobileHeadRef.current, contentRef.current, dockRef.current];
    background.forEach((element) => {
      if (!element) return;
      if (compact && drawerOpen) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
    });
    return () => background.forEach((element) => element?.removeAttribute('inert'));
  }, [compact, drawerOpen]);

  useEffect(() => {
    if (compact && drawerOpen) window.setTimeout(() => searchRef.current?.focus(), 80);
  }, [compact, drawerOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drawerOpen) setDrawerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [drawerOpen]);

  function signOut() {
    setDrawerOpen(false);
    logout();
    navigate('/login', { replace: true });
  }

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="staff-shell">
      <header ref={mobileHeadRef} className="staff-shell__mobile-head" aria-hidden={compact && drawerOpen ? true : undefined}>
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open Staff navigation" aria-expanded={drawerOpen}>
          <Menu aria-hidden="true" />
        </button>
        <div><span>Amari Method</span><strong>{currentItem?.label || 'Staff'}</strong></div>
        <button type="button" onClick={() => { setDrawerOpen(true); window.setTimeout(() => searchRef.current?.focus(), 80); }} aria-label="Find a practice member">
          <Search aria-hidden="true" />
        </button>
      </header>

      <aside ref={railRef} className={`practice-rail${drawerOpen ? ' is-open' : ''}`} aria-label="Staff workspace" aria-hidden={compact && !drawerOpen ? true : undefined}>
        <div className="practice-rail__head">
          <NavLink to="/" className="practice-rail__brand" onClick={closeDrawer}>
            <span className="practice-rail__brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span><strong>Amari Method</strong><small>Practice room</small></span>
          </NavLink>
          <button type="button" className="practice-rail__close" onClick={closeDrawer} aria-label="Close Staff navigation"><X aria-hidden="true" /></button>
        </div>

        <MemberSearch inputRef={searchRef} onChoose={closeDrawer} />

        <nav className="practice-rail__nav" aria-label="Primary Staff navigation">
          <span className="practice-rail__section-label">Daily practice</span>
          <div className="practice-rail__thread" aria-hidden="true" />
          {PRIMARY_ITEMS.map((item) => (
            <RailLink key={item.label} item={item} count={item.badge ? counts[item.badge] : null} onChoose={closeDrawer} />
          ))}
        </nav>

        <div className={`practice-rail__specialists${specialistsOpen ? ' is-open' : ''}`}>
          <button type="button" className="practice-rail__specialist-toggle" onClick={() => setSpecialistsOpen((open) => !open)} aria-expanded={specialistsOpen}>
            <span><strong>Specialist tools</strong><small>Open when the work calls for them</small></span>
            <ChevronDown aria-hidden="true" />
          </button>
          <nav aria-label="Specialist Staff tools">
            {SPECIALIST_ITEMS.map((item) => (
              <RailLink key={item.label} item={item} count={null} onChoose={closeDrawer} />
            ))}
          </nav>
        </div>

        <nav className="practice-rail__settings" aria-label="Staff settings">
          <RailLink item={SETTINGS_ITEM} count={null} onChoose={closeDrawer} />
        </nav>

        <div className="practice-rail__foot">
          <span><i aria-hidden="true" /> Staff workspace</span>
          <button type="button" onClick={signOut}><LogOut aria-hidden="true" /> Sign out</button>
        </div>
      </aside>

      {compact && drawerOpen ? <button type="button" className="staff-shell__scrim" aria-label="Close Staff navigation" onClick={closeDrawer} /> : null}

      <div ref={contentRef} className="staff-shell__main" aria-hidden={compact && drawerOpen ? true : undefined}>
        <div className="staff-shell__content">{children}</div>
      </div>

      {!isReferencePage ? <nav ref={dockRef} className="staff-shell__dock" aria-label="Quick Staff navigation" aria-hidden={compact && drawerOpen ? true : undefined}>
        {PRIMARY_ITEMS.slice(0, 4).map((item) => {
          const active = itemIsActive(item, location.pathname);
          const { Icon } = item;
          return (
            <NavLink key={item.label} to={item.to} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined}>
              <span><Icon aria-hidden="true" />{item.badge ? <CountBadge kind={item.badge} count={counts[item.badge]} /> : null}</span>
              <small>{item.shortLabel || item.label}</small>
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen}>
          <span><Menu aria-hidden="true" />{counts.operations ? <CountBadge kind="operations" count={counts.operations} /> : null}</span>
          <small>More</small>
        </button>
      </nav> : null}
    </div>
  );
}
