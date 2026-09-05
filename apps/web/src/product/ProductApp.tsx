import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { DemoException, ProcessorPayout, WorkspaceState } from '@postonce/contracts';
import { searchWorkspace } from './api';
import { useWorkspace, WorkspaceProvider } from './WorkspaceProvider';
import './product.css';
import './reference.css';

type IconName = 'close' | 'exception' | 'payment' | 'deposit' | 'activity' | 'integration' | 'search' | 'chevron' | 'check' | 'clock' | 'reset' | 'menu' | 'arrow' | 'calendar' | 'location' | 'document' | 'external' | 'adjust';

function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<IconName, ReactNode> = {
    close: <><path d="M4 5.5h16M6.5 3v5M17.5 3v5M5 10.5h14v9H5z" /><path d="m9 15 2 2 4-4" /></>,
    exception: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 8v5M12 16.5v.2" /></>,
    payment: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 15h4" /></>,
    deposit: <><path d="M3 9h18M5 9V7l7-4 7 4v2M6 12v5M10 12v5M14 12v5M18 12v5M3 20h18" /></>,
    activity: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 7v5l3 2" /></>,
    integration: <><path d="M8.5 8.5 6 6m9.5 9.5L18 18M14.5 7.5l2-2a2.1 2.1 0 0 1 3 3l-2 2M9.5 16.5l-2 2a2.1 2.1 0 0 1-3-3l2-2" /><path d="m9 15 6-6" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    reset: <><path d="M4 8V3.5L7.5 7M5.4 7A8 8 0 1 1 4 14" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    arrow: <><path d="M4 12h15M14 7l5 5-5 5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
    location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v7H4V6h7" /></>,
    adjust: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common} {...props}>{paths[name]}</svg>;
}

function Brand() {
  return (
    <span className="po-brand" aria-label="PostOnce">
      <svg className="po-brand__mark" viewBox="0 0 28 32" aria-hidden="true">
        <path fill="#1260e8" d="M14 1 26 8v15L14 31 2 24V8Z" />
        <path fill="#0b4bc0" d="m14 16 12-8v15l-12 8Z" />
        <path fill="#2879f2" d="M2 8 14 1l12 7-12 8Z" />
        <path fill="#1688ff" d="m2 8 12 8v15L2 24Z" />
      </svg>
      <span>PostOnce</span>
    </span>
  );
}

const moneyFormatter = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', currencyDisplay: 'narrowSymbol' });
const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatMoney(cents: number, signed = false): string {
  const prefix = signed && cents < 0 ? '−' : signed && cents > 0 ? '+' : '';
  return `${prefix}${moneyFormatter.format(Math.abs(cents) / 100)}`;
}

function Money({ cents, signed = false }: { cents: number; signed?: boolean }) {
  const text = formatMoney(cents, signed);
  return <span className="po-money" aria-label={`${cents < 0 ? 'negative ' : ''}${Math.abs(cents / 100).toFixed(2)} Canadian dollars`}>{text}</span>;
}

function businessDateLabel(value: string): string {
  return businessDateFormatter.format(new Date(`${value}T12:00:00Z`));
}

function localTime(value: string, includeDate = false): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    ...(includeDate ? { month: 'short', day: 'numeric', year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function sentenceCase(value: string): string {
  return value.toLocaleLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toLocaleUpperCase());
}

function dmsBusinessLabel(value: string): string {
  return value === 'VERIFIED' ? 'Posted · Verified' : sentenceCase(value);
}

function Status({ value, compact = false }: { value: string; compact?: boolean }) {
  const normalized = value.toUpperCase();
  const tone = ['VERIFIED', 'POSTED · VERIFIED', 'READY', 'CLOSED', 'RECONCILED', 'CONNECTED', 'RESOLVED'].includes(normalized)
    ? 'verified'
    : ['OPEN', 'NEEDS_REVIEW', 'NEEDS REVIEW', 'REVIEW'].includes(normalized)
      ? 'review'
      : ['BLOCKED', 'VARIANCE'].includes(normalized)
      ? 'attention'
      : 'neutral';
  const label = normalized === 'POSTED · VERIFIED' ? 'Posted · Verified' : sentenceCase(value);
  return <span className={`po-status po-status--${tone}${compact ? ' po-status--compact' : ''}`}><i aria-hidden="true" />{label}</span>;
}

const navigation = [
  { to: '/app/close', label: 'Close', icon: 'close' },
  { to: '/app/exceptions', label: 'Exceptions', icon: 'exception' },
  { to: '/app/payments', label: 'Payments', icon: 'payment' },
  { to: '/app/deposits', label: 'Deposits', icon: 'deposit' },
  { to: '/app/activity', label: 'Activity', icon: 'activity' },
  { to: '/app/integrations', label: 'Integrations', icon: 'integration' },
] as const;

function GlobalSearch() {
  const { state } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchWorkspace>> | null>(null);
  const searchId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (!state || query.trim().length < 2) {
      setResults(null);
      return;
    }
    const id = ++searchId.current;
    const timeout = window.setTimeout(() => {
      void searchWorkspace(state.session.id, query).then((payload) => {
        if (id === searchId.current) setResults(payload);
      }).catch(() => {
        if (id === searchId.current) setResults({ groups: [], total: 0 });
      });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [query, state]);

  return (
    <div className="po-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <Icon name="search" />
      <label htmlFor="workspace-search" className="po-sr-only">Search workspace</label>
      <input
        ref={inputRef}
        id="workspace-search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && query.trim()) {
            navigate(`/app/payments?q=${encodeURIComponent(query.trim())}`);
            setOpen(false);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder="Search payments, records, deposits…"
        autoComplete="off"
      />
      <kbd>Ctrl K</kbd>
      {open && query.trim().length >= 2 && (
        <div className="po-search-results" role="listbox" aria-label="Search results">
          {!results && <p>Searching…</p>}
          {results?.total === 0 && <p>No workspace records found.</p>}
          {results?.groups.map((group) => (
            <section key={group.key}>
              <h3>{group.label}</h3>
              {group.items.map((item) => (
                <Link key={item.id} to={item.href} onClick={() => { setOpen(false); setQuery(''); }}>
                  <span>{item.label}</span><small>{item.meta}</small>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductShell() {
  const { state, status, error, actionError, pendingLabel, reload, reset, clearActionError } = useWorkspace();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const location = useLocation();
  const openExceptions = state?.exceptions.filter((item) => item.status === 'OPEN').length ?? 0;

  useEffect(() => setMobileMoreOpen(false), [location.pathname]);

  return (
    <div className="po-shell">
      <a className="po-skip" href="#workspace-content">Skip to workspace content</a>
      <aside className="po-sidebar">
        <Link to="/app/close" className="po-sidebar__brand"><Brand /></Link>
        <nav aria-label="Workspace navigation">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : undefined}>
              <Icon name={item.icon} /><span>{item.label}</span>
              {item.label === 'Exceptions' && openExceptions > 0 && <b aria-label={`${openExceptions} open`}>{openExceptions}</b>}
            </NavLink>
          ))}
        </nav>
        <div className="po-sidebar__footer">
          <div className="po-sidebar__organization">Northline Motor Group</div>
          <div className="po-profile-wrap po-profile-wrap--sidebar">
            <button className="po-profile" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen}>
              <span>MC</span><span><strong>{state?.user.name ?? 'Maya Chen'}</strong><small>{state?.user.roleLabel ?? 'Group Controller'}</small></span>
            </button>
            {profileOpen && (
              <div className="po-profile-menu">
                <strong>Northline Motor Group</strong>
                <p>Isolated synthetic workspace</p>
                <button onClick={() => { setProfileOpen(false); void reset(); }} disabled={status !== 'ready' || Boolean(pendingLabel)}><Icon name="reset" /> Reset workspace</button>
              </div>
            )}
          </div>
          <button type="button" className="po-sidebar__reset" onClick={() => void reset()} disabled={status !== 'ready' || Boolean(pendingLabel)}><Icon name="reset" /> Reset workspace</button>
          <small className="po-sidebar__scope">Synthetic data only</small>
        </div>
      </aside>

      <header className="po-topbar">
        <GlobalSearch />
        <div className="po-topbar__organization">Northline Motor Group</div>
        <div className="po-topbar__date"><span>Fri, Sep 4, 2026</span><strong>4:55 PM</strong></div>
      </header>

      {(status === 'unavailable' || actionError) && (
        <div className={`po-banner ${actionError ? 'po-banner--error' : ''}`} role="alert">
          <div>
            <strong>{actionError?.code === 'VERSION_CONFLICT' ? 'Latest record loaded' : actionError?.code === 'WORKSPACE_REFRESHED' ? 'Fresh workspace created' : 'Workspace service unavailable'}</strong>
            <span>{actionError?.code === 'VERSION_CONFLICT'
              ? 'This item was already resolved by Maya Chen. The latest record has been loaded.'
              : (actionError ?? error)?.message}</span>
          </div>
          <button onClick={() => actionError ? clearActionError() : void reload()}>{actionError ? 'Dismiss' : 'Retry'}</button>
        </div>
      )}
      {pendingLabel && <div className="po-pending" role="status" aria-live="polite"><i />{pendingLabel}</div>}

      <main id="workspace-content" className="po-main" aria-busy={Boolean(pendingLabel)} key={location.pathname}>
        <Outlet />
      </main>

      <nav className="po-mobile-nav" aria-label="Mobile workspace navigation">
        {navigation.slice(0, 4).map((item) => (
          <NavLink key={item.to} to={item.to}><Icon name={item.icon} /><span>{item.label}</span></NavLink>
        ))}
        <div className="po-mobile-more">
          <button type="button" aria-expanded={mobileMoreOpen} aria-haspopup="menu" onClick={() => setMobileMoreOpen((value) => !value)}><Icon name="menu" /><span>More</span></button>
          {mobileMoreOpen && <div className="po-mobile-more__menu" role="menu"><div className="po-mobile-more__identity"><strong>{state?.user.name ?? 'Maya Chen'}</strong><small>{state?.user.roleLabel ?? 'Group Controller'}</small></div><NavLink role="menuitem" to="/app/activity"><Icon name="activity" />Activity</NavLink><NavLink role="menuitem" to="/app/integrations"><Icon name="integration" />Integrations</NavLink><button type="button" role="menuitem" disabled={status !== 'ready' || Boolean(pendingLabel)} onClick={() => { setMobileMoreOpen(false); void reset(); }}><Icon name="reset" />Reset workspace</button></div>}
        </div>
      </nav>
    </div>
  );
}

function WorkspaceGate({ children }: { children: (state: WorkspaceState) => ReactNode }) {
  const { state, status, reload } = useWorkspace();
  if (status === 'loading') {
    return <div className="po-page-state" role="status"><div className="po-skeleton po-skeleton--title" /><div className="po-skeleton" /><div className="po-skeleton" /></div>;
  }
  if (status === 'unavailable' || !state) {
    return <div className="po-page-state"><span className="po-state-mark">!</span><h1>Workspace unavailable</h1><p>The product shell is ready, but financial actions stay disabled until the service responds.</p><button className="po-button po-button--primary" onClick={() => void reload()}>Retry workspace</button></div>;
  }
  return <>{children(state)}</>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="po-page-heading">
      <div>{eyebrow && <span className="po-eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>
      {action && <div>{action}</div>}
    </header>
  );
}

function ConfirmClose({ state, rooftopId, onDismiss, onClosed }: { state: WorkspaceState; rooftopId: string; onDismiss: () => void; onClosed: (rooftopId: string, rooftopName: string) => void }) {
  const { closeLocation, pendingLabel } = useWorkspace();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const completedRef = useRef(false);
  const rooftop = state.rooftops.find((item) => item.id === rooftopId)!;
  const close = state.operationalCloses.find((item) => item.rooftopId === rooftopId)!;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    confirmRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (!completedRef.current && previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return (
      <dialog ref={dialogRef} className="po-dialog" aria-modal="true" aria-labelledby={`close-dialog-${rooftopId}`} onCancel={(event) => { event.preventDefault(); onDismiss(); }} onMouseDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
      }}>
        <span className="po-eyebrow">Final attestation</span>
        <h2 id={`close-dialog-${rooftopId}`}>Close {rooftop.name}?</h2>
        <p>This seals the operational close. Settlement can arrive afterward and does not block this action.</p>
        <dl className="po-confirm-grid">
          <div><dt>Payments</dt><dd>{close.paymentCount}</dd></div>
          <div><dt>Verified posts</dt><dd>{close.verifiedPostingCount}</dd></div>
          <div><dt>Open blockers</dt><dd>{close.blockingExceptionCount}</dd></div>
          <div><dt>Settlement</dt><dd>{sentenceCase(close.settlementStatus)}</dd></div>
        </dl>
        <div className="po-dialog__actions">
          <button className="po-button po-button--quiet" onClick={onDismiss}>Cancel</button>
          <button ref={confirmRef} className="po-button po-button--primary" disabled={Boolean(pendingLabel)} onClick={() => { void closeLocation(rooftopId, close.version).then((ok) => { if (ok) { completedRef.current = true; onClosed(rooftopId, rooftop.name); } }); }}>Close location</button>
        </div>
      </dialog>
  );
}

export function ClosePage() {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [closedAnnouncement, setClosedAnnouncement] = useState('');
  const [focusAttestation, setFocusAttestation] = useState<string | null>(null);
  useEffect(() => {
    if (!focusAttestation) return;
    document.querySelector<HTMLElement>(`[data-close-attestation="${focusAttestation}"]`)?.focus();
    setFocusAttestation(null);
  }, [focusAttestation]);
  const handleClosed = (rooftopId: string, rooftopName: string) => {
    setConfirming(null);
    setClosedAnnouncement(`${rooftopName} operational close sealed by Maya Chen. Settlement remains independent.`);
    setFocusAttestation(rooftopId);
  };
  return (
    <WorkspaceGate>{(state) => {
      const closes = state.operationalCloses;
      const ready = closes.filter((item) => item.status === 'READY').length;
      const blocked = closes.filter((item) => item.status === 'BLOCKED').length;
      const closed = closes.filter((item) => item.status === 'CLOSED').length;
      const variancePayouts = state.payouts.filter((item) => item.payoutDate !== state.metadata.businessDate && item.status === 'VARIANCE');
      return (
        <div className="po-page po-close-page">
          <div className="po-sr-only" role="status" aria-live="polite">{closedAnnouncement}</div>
          <header className="po-close-heading">
            <div>
              <span className="po-eyebrow">Daily close</span>
              <h1>Friday Close</h1>
              <p>Northline Motor Group</p>
              <small>Review each location’s progress and resolve any exceptions before closing the day.</small>
              <span className="po-sr-only">{ready} locations ready · {blocked} blocked · {closed} closed</span>
            </div>
            <time className="po-date-switcher" dateTime={state.metadata.businessDate}><Icon name="calendar" /><span>{businessDateLabel(state.metadata.businessDate)}</span></time>
          </header>
          <section className="po-close-board" aria-label="Location close readiness">
            <div className="po-close-board__legend" aria-hidden="true">
              <span>Location</span>
              <span>Payments<small>Received</small></span>
              <span>DMS posting<small>Verified</small></span>
              <span>Open work<small>Blocking</small></span>
              <span>Settlement<small>Independent</small></span>
              <span>Close</span>
            </div>
            {closes.map((close) => {
              const rooftop = state.rooftops.find((item) => item.id === close.rooftopId)!;
              const exceptions = state.exceptions.filter((item) => item.rooftopId === rooftop.id && item.status === 'OPEN');
              const payout = state.payouts.find((item) => item.rooftopId === rooftop.id && item.payoutDate === state.metadata.businessDate)!;
              const initials = rooftop.name.split(' ').map((word) => word[0]).join('').slice(-2);
              return (
                <article key={rooftop.id} className={`po-close-rail po-close-rail--${close.status.toLocaleLowerCase()}`}>
                  <header className="po-close-location">
                    <span className="po-location-avatar">{initials}</span>
                    <div><h2>{rooftop.name} <Icon name="chevron" /></h2></div>
                  </header>
                  <div className="po-close-step po-close-step--complete"><span className="po-step-icon"><Icon name="check" /></span><div><strong>{close.paymentCount}</strong><p>Received</p></div></div>
                  <div className={`po-close-step ${close.verifiedPostingCount === close.paymentCount ? 'po-close-step--complete' : 'po-close-step--attention'}`}><span className="po-step-icon">{close.verifiedPostingCount === close.paymentCount ? <Icon name="check" /> : '!'}</span><div><strong>{close.verifiedPostingCount}</strong><p>{close.verifiedPostingCount === close.paymentCount ? 'Verified' : 'Need review'}</p></div></div>
                  <div className={`po-close-step ${exceptions.length ? 'po-close-step--attention' : 'po-close-step--complete'}`}><span className="po-step-icon">{exceptions.length || <Icon name="check" />}</span><div><strong>{exceptions.length || 'None'}</strong><p>{exceptions.length ? 'Blocking' : 'Open work'}</p></div></div>
                  <div className="po-close-step po-close-step--settlement"><span className="po-step-icon"><Icon name={payout.status === 'RECONCILED' ? 'check' : 'clock'} /></span><div><strong>{sentenceCase(payout.status)}</strong><p>Independent</p></div></div>
                  <div className={`po-close-action${close.status === 'CLOSED' ? ' po-close-action--closed' : ''}`}>
                    {close.status === 'CLOSED' && close.attestation ? (
                      <div className="po-attestation" data-close-attestation={rooftop.id} tabIndex={-1}><Icon name="check" /><strong>Closed by {close.closedBy}</strong><small>{localTime(close.closedAt!, true)}</small></div>
                    ) : close.status === 'BLOCKED' ? (
                      <Link className="po-close-endpoint po-close-endpoint--blocked" aria-label={`${close.blockingExceptionCount} blockers`} to={`/app/exceptions?location=${rooftop.code}&status=OPEN&sort=newest`}><i /><span><strong>Blocked</strong></span><Icon name="chevron" /></Link>
                    ) : (
                      <button className="po-close-endpoint" aria-label="Close location" onClick={() => setConfirming(rooftop.id)}><i /><span><strong>Ready</strong></span><Icon name="chevron" /></button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
          {variancePayouts.length > 0 && <section className="po-prior-settlements" aria-labelledby="prior-settlements-title">
            <header><div><h2 id="prior-settlements-title">Prior settlements requiring attention</h2></div></header>
            <div className="po-prior-settlements__legend" aria-hidden="true"><span>Date</span><span>Location</span><span>Type</span><span>Details</span><span>Action</span></div>
            {variancePayouts.map((payout) => {
              const rooftop = state.rooftops.find((item) => item.id === payout.rooftopId)!;
              return <Link className="po-prior-settlement-row" key={payout.id} to={`/app/deposits/${payout.id}`}><time>Sep 3</time><div><strong>{rooftop.name}</strong><small>{rooftop.code}</small></div><span>Deposit variance</span><span><Money cents={payout.varianceCents ?? 0} /> unexplained</span><b>Review <Icon name="arrow" /></b></Link>;
            })}
          </section>}
          {confirming && <ConfirmClose state={state} rooftopId={confirming} onDismiss={() => setConfirming(null)} onClosed={handleClosed} />}
        </div>
      );
    }}</WorkspaceGate>
  );
}

function exceptionAge(state: WorkspaceState, exception: DemoException): number {
  return Math.max(0, Math.round((Date.parse(state.metadata.workspaceAsOf) - Date.parse(exception.openedAt)) / 60_000));
}

export function ExceptionsPage() {
  const [params, setParams] = useSearchParams();
  return (
    <WorkspaceGate>{(state) => {
      const location = params.get('location') ?? 'NLF';
      const department = params.get('department') ?? 'ALL';
      const type = params.get('type') ?? 'ALL';
      const status = params.get('status') ?? 'OPEN';
      const sort = params.get('sort') ?? 'newest';
      const query = (params.get('q') ?? '').toLocaleLowerCase();
      const rooftop = state.rooftops.find((item) => item.code === location || item.id === location);
      let items = state.exceptions.filter((item) => (location === 'ALL' || rooftop?.id === item.rooftopId)
        && (department === 'ALL' || item.department === department)
        && (type === 'ALL' || item.type === type)
        && (status === 'ALL' || item.status === status));
      if (query) items = items.filter((item) => [item.id, item.title, item.summary, item.paymentId].join(' ').toLocaleLowerCase().includes(query));
      items = [...items].sort((left, right) => {
        if (sort === 'oldest') return Date.parse(left.openedAt) - Date.parse(right.openedAt);
        if (sort === 'amount-high') {
          const leftAmount = state.payments.find((item) => item.id === left.paymentId)?.amountCents ?? 0;
          const rightAmount = state.payments.find((item) => item.id === right.paymentId)?.amountCents ?? 0;
          return rightAmount - leftAmount;
        }
        return Date.parse(right.openedAt) - Date.parse(left.openedAt);
      });
      const update = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next); };
      return (
        <div className="po-page po-exceptions-page">
          <Link className="po-back-link" to="/app/close"><span>←</span> Back to Close</Link>
          <header className="po-exceptions-heading">
            <div><span className="po-eyebrow">Exceptions</span><h1>{rooftop?.name ?? 'All locations'}</h1><p><strong>{items.length} {items.length === 1 ? 'item' : 'items'} blocking close</strong></p><small>Review and resolve the exceptions below to complete today’s close.</small></div>
            <details className="po-filter-menu">
              <summary><Icon name="adjust" /> Sort by {sort === 'amount-high' ? 'Amount' : sentenceCase(sort)} <Icon name="chevron" /></summary>
              <div className="po-filterbar">
                <label>Location<select value={location} onChange={(event) => update('location', event.target.value)}><option value="ALL">All locations</option>{state.rooftops.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
                <label>Department<select value={department} onChange={(event) => update('department', event.target.value)}><option value="ALL">All departments</option><option value="SERVICE">Service</option><option value="PARTS">Parts</option><option value="SALES">Sales</option></select></label>
                <label>Type<select value={type} onChange={(event) => update('type', event.target.value)}><option value="ALL">All types</option>{[...new Set(state.exceptions.map((item) => item.type))].sort().map((value) => <option key={value} value={value}>{sentenceCase(value)}</option>)}</select></label>
                <label>Status<select value={status} onChange={(event) => update('status', event.target.value)}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="ALL">All</option></select></label>
                <label>Sort<select value={sort} onChange={(event) => update('sort', event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="amount-high">Amount high</option></select></label>
              </div>
            </details>
          </header>
          <section className="po-work-slips" aria-label="Exceptions">
            {items.map((exception) => {
              const payment = state.payments.find((item) => item.id === exception.paymentId)!;
              return (
                <Link className="po-work-slip" to={`/app/exceptions/${exception.id}`} key={exception.id}>
                  <div className="po-work-slip__meta"><span>{exception.id}</span><small>{sentenceCase(exception.department)}</small><em>Payment exception</em></div>
                  <div className="po-work-slip__amount"><Money cents={payment.kind === 'REFUND' ? -payment.amountCents : payment.amountCents} signed={payment.kind === 'REFUND'} /><strong>{payment.customerLabel}</strong><small>{payment.id} · {payment.methodType} •••• {payment.cardLast4}</small></div>
                  <div className="po-work-slip__body"><h2>{exception.title}</h2><p>{exception.summary}</p></div>
                  <div className="po-work-slip__age"><Icon name="clock" /><strong>{exceptionAge(state, exception)} min ago</strong></div>
                  <div className="po-work-slip__review"><span>Review</span><Icon name="arrow" /></div>
                </Link>
              );
            })}
            {items.length === 0 && <div className="po-empty"><Icon name="check" /><h2>No exceptions in this view</h2><p>Adjust the filters or return to daily close.</p><Link to="/app/close">Return to close</Link></div>}
          </section>
        </div>
      );
    }}</WorkspaceGate>
  );
}

function Breadcrumbs({ children }: { children: ReactNode }) {
  return <nav className="po-breadcrumbs" aria-label="Breadcrumb">{children}</nav>;
}

function DetailFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="po-detail-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function ExceptionDetailPage() {
  const { exceptionId = '' } = useParams();
  const { resolveException, pendingLabel } = useWorkspace();
  const [selection, setSelection] = useState<string | null>(null);
  return (
    <WorkspaceGate>{(state) => {
      const exception = state.exceptions.find((item) => item.id.toLocaleLowerCase() === exceptionId.toLocaleLowerCase());
      if (!exception) return <NotFound title="Exception not found" />;
      const payment = state.payments.find((item) => item.id === exception.paymentId)!;
      const rooftop = state.rooftops.find((item) => item.id === exception.rooftopId)!;
      const selectedId = selection ?? exception.suggestedCandidateId ?? exception.candidates[0]?.id ?? null;
      const selected = exception.candidates.find((item) => item.id === selectedId) ?? null;
      const targetRecord = selected ? state.dmsRecords.find((item) => item.id === selected.targetId || (item.rooftopId === exception.rooftopId && item.recordNumber === selected.recordNumber)) : null;
      const targetPayment = selected?.targetType === 'ORIGINAL_PAYMENT' ? state.payments.find((item) => item.id === selected.targetId) : null;
      const exceptionAttempts = state.integrationAttempts.filter((item) => item.externalEventId === payment.externalEventId || item.operationKey === payment.postingOperationKey);
      const exceptionAudits = state.auditEvents.filter((item) => item.entityId === exception.id || item.entityId === payment.id);
      const unsupportedShortfall = exception.type === 'AMBIGUOUS_MATCH' && targetRecord
        ? Math.max(0, payment.amountCents - targetRecord.balanceCents)
        : 0;
      const evidenceLabels = [...new Set(exception.candidates.flatMap((candidate) => candidate.evidence.map((fact) => fact.label)))];
      const actionLabel = exception.type === 'UNMATCHED_REFUND'
        ? `Link ${formatMoney(payment.amountCents)} refund to ${selected?.recordNumber ?? 'original payment'}`
        : exception.type === 'SPLIT_ALLOCATION'
          ? `Apply ${formatMoney(payment.amountCents)} remainder to ${selected?.recordNumber ?? 'record'}`
          : `Apply ${formatMoney(payment.amountCents)} to ${selected?.recordNumber ?? 'record'}`;
      return (
        <div className="po-page po-decision-page">
          <Link className="po-back-link" to="/app/exceptions"><span>←</span> Back to Exceptions</Link>
          <header className="po-decision-heading">
            <div><div className="po-decision-heading__id"><h1>{exception.id}</h1><Status value={exception.status} compact /></div><h2>{exception.title}</h2><p>{exception.summary}</p></div>
            <dl><DetailFact label="Location">{rooftop.name}</DetailFact><DetailFact label="Opened">{exceptionAge(state, exception)} min ago</DetailFact><DetailFact label="Business date">Sep 4, 2026</DetailFact></dl>
          </header>
          {exception.status === 'RESOLVED' && exception.resolution ? (
            <section className="po-resolution-complete" role="status" aria-live="polite"><span><Icon name="check" /></span><div><small>Dealership-system write verified</small><h2>{exception.resolution.targetLabel}</h2><p>Resolved by {exception.resolution.actor} at {localTime(exception.resolution.resolvedAt)}. One operation key produced one financial mutation.</p></div><Status value={dmsBusinessLabel('VERIFIED')} /></section>
          ) : (
            <>
              <div className="po-decision-bench">
                <section className="po-source-card">
                  <span className="po-bench-label">Payment</span>
                  <div className="po-source-card__amount"><Money cents={payment.kind === 'REFUND' ? -payment.amountCents : payment.amountCents} signed={payment.kind === 'REFUND'} /></div>
                  <h2>{payment.customerLabel}</h2>
                  <p>{payment.methodType} •••• {payment.cardLast4}</p>
                  <dl>
                    <DetailFact label="Payment ID">{payment.id}</DetailFact>
                    <DetailFact label="Location">{rooftop.name}</DetailFact>
                    <DetailFact label="Department">{sentenceCase(payment.department)}</DetailFact>
                    <DetailFact label="Captured">{localTime(payment.receivedAt, true)}</DetailFact>
                    <DetailFact label="Terminal">{payment.terminalLabel}</DetailFact>
                  </dl>
                </section>

                <section className={`po-candidate-panel${exception.candidates.length === 1 ? ' po-candidate-panel--single' : ''}`}>
                  <span className="po-bench-label">Match analysis</span>
                  <fieldset>
                    <legend>{exception.candidates.length} possible {exception.candidates.length === 1 ? 'record' : 'records'}</legend>
                    <div className="po-candidate-headings">
                      <span>Compare</span>
                      {exception.candidates.map((candidate) => (
                        <label key={candidate.id} className={selectedId === candidate.id ? 'selected' : ''}>
                          <input type="radio" name="candidate" value={candidate.id} checked={selectedId === candidate.id} disabled={Boolean(pendingLabel)} onChange={() => setSelection(candidate.id)} />
                          <span className="po-candidate__radio" />
                          <span><strong>{candidate.recordNumber}</strong><small>{candidate.statusLabel}</small></span>
                        </label>
                      ))}
                    </div>
                    <div className="po-comparison-matrix">
                      {evidenceLabels.map((label) => <div className="po-comparison-row" key={label}><span>{label}</span>{exception.candidates.map((candidate) => { const fact = candidate.evidence.find((item) => item.label === label); return <div key={candidate.id} className={`${selectedId === candidate.id ? 'selected ' : ''}po-evidence-fact--${fact?.tone.toLocaleLowerCase() ?? 'context'}`}><strong>{fact?.value ?? '—'}</strong></div>; })}</div>)}
                      <div className="po-comparison-row po-comparison-row--recommendation"><span>Assessment</span>{exception.candidates.map((candidate) => <div key={candidate.id} className={selectedId === candidate.id ? 'selected' : ''}><span className={`po-recommendation po-recommendation--${candidate.recommendation === 'STRONG_MATCH' ? 'strong' : 'possible'}`}>{sentenceCase(candidate.recommendation)}</span></div>)}</div>
                    </div>
                  </fieldset>
                </section>

                <section className="po-selected-card">
                  <span className="po-bench-label">Selected record</span>
                  {selected ? <>
                    <div className="po-selected-card__heading"><span><Icon name="check" /></span><div><small>{selected.statusLabel}</small><h2>{selected.recordNumber}</h2></div></div>
                    <dl>
                      <DetailFact label="Customer">{selected.customerLabel}</DetailFact>
                      {selected.vehicleLabel && <DetailFact label="Vehicle">{selected.vehicleLabel}</DetailFact>}
                      <DetailFact label="Department">{sentenceCase(selected.department)}</DetailFact>
                      {selected.advisorLabel && <DetailFact label="Advisor">{selected.advisorLabel}</DetailFact>}
                      {targetRecord && <><DetailFact label="Customer-pay total"><Money cents={targetRecord.customerPayCents} /></DetailFact><DetailFact label="Open balance"><Money cents={targetRecord.balanceCents} /></DetailFact></>}
                      {targetPayment && <DetailFact label="Original payment">{targetPayment.id} · {localTime(targetPayment.receivedAt, true)}</DetailFact>}
                      {exception.type === 'SPLIT_ALLOCATION' && <><DetailFact label="Already posted"><Money cents={155_000} /></DetailFact><DetailFact label="This payment"><Money cents={245_000} /></DetailFact></>}
                    </dl>
                    <div className={`po-write-note${unsupportedShortfall ? ' po-write-note--blocked' : ''}`}><strong>{unsupportedShortfall ? 'Balance does not support this payment' : 'Ready to apply'}</strong><p>{unsupportedShortfall ? `${formatMoney(unsupportedShortfall)} exceeds the remaining balance.` : 'One verified write will clear this blocker.'}</p></div>
                  </> : <p>Select a candidate to continue.</p>}
                </section>
              </div>
              <div className="po-decision-actions">
                <div><Link to="/app/exceptions">Leave unresolved</Link><button type="button" onClick={() => document.getElementById('workspace-search')?.focus()}>Search other records</button></div>
                <button className="po-button po-button--primary" disabled={!selected || Boolean(pendingLabel) || unsupportedShortfall > 0} onClick={() => selected && void resolveException(exception.id, exception.version, selected.targetId)}>{pendingLabel ?? (unsupportedShortfall ? `Cannot apply · ${formatMoney(unsupportedShortfall)} over balance` : actionLabel)}{!unsupportedShortfall && <Icon name="arrow" />}</button>
              </div>
            </>
          )}
          <section className="po-detail-activity"><div className="po-section-heading"><div><span className="po-card-index">Business activity</span><h2>Activity</h2></div></div><ol><li><time>{localTime(exception.openedAt)}</time><div><strong>Exception opened</strong><p>{exception.summary}</p></div></li>{exceptionAudits.map((event) => <li key={event.id}><time>{localTime(event.occurredAt)}</time><div><strong>{event.summary}</strong><p>{event.actor}</p></div></li>)}</ol></section>
          <details className="po-technical-evidence"><summary>Technical evidence <span>Collapsed by default</span><Icon name="chevron" /></summary><dl><DetailFact label="Processor event">{payment.externalEventId}</DetailFact><DetailFact label="Record version">{exception.version}</DetailFact><DetailFact label="Posting operation">{payment.postingOperationKey ?? 'Created after the decision is accepted'}</DetailFact><DetailFact label="Recorded attempts">{exceptionAttempts.length}</DetailFact></dl></details>
        </div>
      );
    }}</WorkspaceGate>
  );
}

export function PaymentsPage() {
  const [params, setParams] = useSearchParams();
  return (
    <WorkspaceGate>{(state) => {
      const query = params.get('q') ?? '';
      const location = params.get('location') ?? 'ALL';
      const department = params.get('department') ?? 'ALL';
      const paymentState = params.get('paymentState') ?? 'ALL';
      const dmsState = params.get('dmsState') ?? 'ALL';
      const settlementState = params.get('settlementState') ?? 'ALL';
      const method = params.get('method') ?? 'ALL';
      const date = params.get('date') ?? state.metadata.businessDate;
      const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value === 'ALL' || !value) next.delete(key); else next.set(key, value); setParams(next); };
      const normalized = query.toLocaleLowerCase();
      const paymentDates = [...new Set(state.payments.map((item) => item.businessDate))].sort((left, right) => right.localeCompare(left));
      const paymentMethods = [...new Set(state.payments.map((item) => item.methodType))].sort();
      const items = state.payments.filter((payment) => {
        const rooftop = state.rooftops.find((item) => item.id === payment.rooftopId)!;
        const record = state.dmsRecords.find((item) => item.id === payment.linkedRecordId);
        const relatedAttempts = state.integrationAttempts.filter((item) => item.externalEventId === payment.externalEventId || item.operationKey === payment.postingOperationKey);
        const searchable = [payment.id, payment.customerLabel, payment.processorTransactionId, payment.externalEventId, payment.cardLast4, payment.sourceReference, payment.postingOperationKey, record?.recordNumber, String(payment.amountCents), (payment.amountCents / 100).toFixed(2), formatMoney(payment.amountCents), ...relatedAttempts.map((item) => item.correlationId)].filter(Boolean).join(' ').toLocaleLowerCase();
        return (location === 'ALL' || rooftop.code === location)
          && (department === 'ALL' || payment.department === department)
          && (paymentState === 'ALL' || payment.paymentState === paymentState)
          && (dmsState === 'ALL' || payment.dmsState === dmsState)
          && (settlementState === 'ALL' || payment.settlementState === settlementState)
          && (method === 'ALL' || payment.methodType === method)
          && (date === 'ALL' || payment.businessDate === date)
          && (!normalized || searchable.includes(normalized))
          ;
      }).sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
      return (
        <div className="po-page">
          <PageHeading eyebrow="Payment ledger" title="Payments" description="62 Friday payment events across three locations, with business context first and technical evidence one layer down." />
          <div className="po-filterbar po-filterbar--payments">
            <label className="po-filter-search"><Icon name="search" /><span>Search payments</span><input value={query} onChange={(event) => update('q', event.target.value)} placeholder="Customer, record, amount…" /></label>
            <label>Location<select value={location} onChange={(event) => update('location', event.target.value)}><option value="ALL">All locations</option>{state.rooftops.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
            <label>Department<select value={department} onChange={(event) => update('department', event.target.value)}><option value="ALL">All</option><option value="SERVICE">Service</option><option value="PARTS">Parts</option><option value="SALES">Sales</option></select></label>
            <label>Payment<select value={paymentState} onChange={(event) => update('paymentState', event.target.value)}><option value="ALL">All</option>{[...new Set(state.payments.map((item) => item.paymentState))].sort().map((value) => <option key={value} value={value}>{sentenceCase(value)}</option>)}</select></label>
            <label>DMS<select value={dmsState} onChange={(event) => update('dmsState', event.target.value)}><option value="ALL">All</option>{[...new Set(state.payments.map((item) => item.dmsState))].sort().map((value) => <option key={value} value={value}>{dmsBusinessLabel(value)}</option>)}</select></label>
            <label>Settlement<select value={settlementState} onChange={(event) => update('settlementState', event.target.value)}><option value="ALL">All</option>{[...new Set(state.payments.map((item) => item.settlementState))].sort().map((value) => <option key={value} value={value}>{sentenceCase(value)}</option>)}</select></label>
            <label>Method<select value={method} onChange={(event) => update('method', event.target.value)}><option value="ALL">All methods</option>{paymentMethods.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Date<select value={date} onChange={(event) => update('date', event.target.value)}><option value="ALL">All dates</option>{paymentDates.map((value) => <option key={value} value={value}>{value === state.metadata.businessDate ? 'Friday, Sep 4' : value}</option>)}</select></label>
            <span className="po-filterbar__count">{items.length} shown</span>
          </div>
          <div className="po-table-wrap">
            <table className="po-table">
              <caption className="po-sr-only">Payment ledger for Friday September 4, 2026</caption>
              <thead><tr><th scope="col">Payment</th><th scope="col">Customer / record</th><th scope="col">Location</th><th scope="col">Department</th><th scope="col">Amount</th><th scope="col">DMS</th><th scope="col">Settlement</th><th scope="col"><span className="po-sr-only">Open</span></th></tr></thead>
              <tbody>{items.map((payment) => {
                const rooftop = state.rooftops.find((item) => item.id === payment.rooftopId)!;
                const record = state.dmsRecords.find((item) => item.id === payment.linkedRecordId);
                return <tr key={payment.id}>
                  <td data-label="Payment"><Link className="po-table-cell po-table-cell--link" to={`/app/payments/${payment.id}`}><strong>{payment.id}</strong><small>{payment.methodType} •••• {payment.cardLast4} · {localTime(payment.receivedAt)}</small></Link></td>
                  <td data-label="Customer / record"><div className="po-table-cell"><strong>{payment.customerLabel}</strong><small>{record?.recordNumber ?? 'Decision required'}</small></div></td>
                  <td data-label="Location"><div className="po-table-cell">{rooftop.code}<small>{rooftop.name.replace('Northline ', '')}</small></div></td>
                  <td data-label="Department">{sentenceCase(payment.department)}</td>
                  <td data-label="Amount"><Money cents={payment.kind === 'REFUND' ? -payment.amountCents : payment.amountCents} signed={payment.kind === 'REFUND'} /></td>
                  <td data-label="DMS"><Status value={dmsBusinessLabel(payment.dmsState)} compact /></td>
                  <td data-label="Settlement"><Status value={payment.settlementState} compact /></td>
                  <td><Link className="po-row-link" to={`/app/payments/${payment.id}`} aria-label={`Open ${payment.id}`}><Icon name="chevron" /></Link></td>
                </tr>;
              })}</tbody>
            </table>
            {items.length === 0 && <div className="po-empty po-empty--table"><h2>No matching payments</h2><p>Try another customer, record, card, or filter.</p></div>}
          </div>
        </div>
      );
    }}</WorkspaceGate>
  );
}

export function PaymentDetailPage() {
  const { paymentId = '' } = useParams();
  return (
    <WorkspaceGate>{(state) => {
      const payment = state.payments.find((item) => item.id.toLocaleLowerCase() === paymentId.toLocaleLowerCase());
      if (!payment) return <NotFound title="Payment not found" />;
      const rooftop = state.rooftops.find((item) => item.id === payment.rooftopId)!;
      const record = state.dmsRecords.find((item) => item.id === payment.linkedRecordId);
      const allocation = state.allocations.find((item) => item.paymentId === payment.id);
      const attempts = state.integrationAttempts.filter((item) => item.externalEventId === payment.externalEventId || item.operationKey === payment.postingOperationKey);
      const lost = attempts.some((item) => item.status === 'RESPONSE_LOST');
      return (
        <div className="po-page po-payment-detail">
          <Link className="po-back-link" to="/app/payments"><span>←</span> Back to Payments</Link>
          <header className="po-payment-heading">
            <div><span className="po-eyebrow">Payment</span><h1><Money cents={payment.kind === 'REFUND' ? -payment.amountCents : payment.amountCents} signed={payment.kind === 'REFUND'} /></h1><p>{payment.kind === 'REFUND' ? 'Refund payment' : 'Routine payment'}</p><small>{rooftop.name} · {sentenceCase(payment.department)}{record ? ` · ${record.recordNumber}` : ''}</small></div>
          </header>
          <section className="po-state-ribbon" aria-label="Payment lifecycle">
            <div className="complete"><span><Icon name="check" /></span><div><small>Payment</small><strong>{sentenceCase(payment.paymentState)}</strong><p>{localTime(payment.receivedAt, true)} · {payment.methodType} •••• {payment.cardLast4}</p></div></div>
            <div className={payment.dmsState === 'VERIFIED' ? 'complete' : 'attention'}><span>{payment.dmsState === 'VERIFIED' ? <Icon name="check" /> : '!'}</span><div><small>DMS posting</small><strong>{dmsBusinessLabel(payment.dmsState)}</strong><p>{record ? `${record.recordNumber} · ${record.customerLabel}` : 'Controller decision required'}</p></div></div>
            <div className={payment.settlementState === 'RECONCILED' ? 'complete' : ''}><span>{payment.settlementState === 'RECONCILED' ? <Icon name="check" /> : <Icon name="clock" />}</span><div><small>Settlement</small><strong>{sentenceCase(payment.settlementState)}</strong><p>{payment.settlementState === 'RECONCILED' ? 'Included in processor payout' : 'Tracked independently'}</p></div></div>
          </section>
          <section className="po-history"><div className="po-section-heading"><div><span className="po-eyebrow">Immutable record</span><h2>Payment History</h2></div><small>{attempts.length} integration attempts</small></div>
            <div className="po-payment-history-grid">
              <ol>
                <li><span className="po-timeline-dot po-timeline-dot--good"><Icon name="check" /></span><time>{localTime(payment.receivedAt)}</time><div><strong>Payment received</strong><p>Processor authorization captured.</p></div></li>
                {payment.matchedAt && <li><span className="po-timeline-dot po-timeline-dot--good"><Icon name="check" /></span><time>{localTime(payment.matchedAt)}</time><div><strong>Matched to {record?.recordNumber ?? 'record'}</strong><p>{allocation?.source === 'HUMAN_RESOLUTION' ? 'Controller judgment accepted.' : 'Exact repair-order reference.'}</p></div></li>}
                {payment.postedAt && <li><span className="po-timeline-dot po-timeline-dot--good"><Icon name="check" /></span><time>{localTime(payment.postedAt)}</time><div><strong>Posted to dealership system</strong><p>Stable operation identity recorded.</p></div></li>}
                {payment.verifiedAt && <li><span className="po-timeline-dot po-timeline-dot--good"><Icon name="check" /></span><time>{localTime(payment.verifiedAt)}</time><div><strong>Posting verified</strong><p>Existing DMS write confirmed.</p></div></li>}
              </ol>
              {lost && <details className="po-payment-evidence"><summary><strong>Evidence · response recovery</strong><span><b className="po-payment-evidence__expand">Expand</b><b className="po-payment-evidence__collapse">Collapse</b><Icon name="chevron" /></span></summary><div className="po-payment-evidence__body"><span className="po-sr-only">One effect, proven across two attempts</span><div className="po-proof-table"><div className="po-proof-table__head"><span>Attempt</span><span>Operation</span><span>Result</span></div>{attempts.filter((item) => item.system === 'LEGACY_DMS').map((attempt) => <div className="po-proof-table__row" key={attempt.id}><strong>{localTime(attempt.occurredAt)}</strong><div><b>{attempt.operation}</b><code>{attempt.operationKey}</code><small>{attempt.note}</small></div><Status value={attempt.status} compact /></div>)}<div className="po-proof-table__result"><span>Financial mutations</span><strong>1</strong><small>No duplicate posting</small></div></div></div></details>}
            </div>
          </section>
          <section className="po-payment-details">
            <div className="po-section-heading"><div><span className="po-eyebrow">Record context</span><h2>Business details</h2></div></div>
            <div className="po-payment-details__grid">
              <dl><DetailFact label="Customer">{payment.customerLabel}</DetailFact><DetailFact label="Processor reference">{payment.processorTransactionId}</DetailFact><DetailFact label="Terminal">{payment.terminalLabel}</DetailFact><DetailFact label="Business date">Friday, Sep 4, 2026</DetailFact></dl>
              {record ? <dl><DetailFact label="Applied record">{record.recordNumber}</DetailFact><DetailFact label="Vehicle">{record.vehicleLabel ?? '—'}</DetailFact><DetailFact label="Advisor">{record.advisorLabel ?? '—'}</DetailFact><DetailFact label="Applied amount"><Money cents={allocation?.amountCents ?? payment.amountCents} /></DetailFact></dl> : <p>No DMS record has been selected yet.</p>}
            </div>
            <details className="po-technical-evidence"><summary>Technical identifiers <span>Evidence seam</span><Icon name="chevron" /></summary><dl><DetailFact label="Processor event">{payment.externalEventId}</DetailFact><DetailFact label="Operation key">{payment.postingOperationKey ?? 'Not created'}</DetailFact><DetailFact label="Correlation IDs">{[...new Set(attempts.map((item) => item.correlationId))].join(', ') || 'None recorded'}</DetailFact></dl></details>
          </section>
        </div>
      );
    }}</WorkspaceGate>
  );
}

function payoutName(state: WorkspaceState, payout: ProcessorPayout): string {
  return state.rooftops.find((item) => item.id === payout.rooftopId)?.name ?? payout.rooftopId;
}

export function DepositsPage() {
  return (
    <WorkspaceGate>{(state) => {
      const items = [...state.payouts].sort((left, right) => right.payoutDate.localeCompare(left.payoutDate) || payoutName(state, left).localeCompare(payoutName(state, right)));
      return <div className="po-page"><PageHeading eyebrow="Settlement ledger" title="Deposits" description="Processor payouts and bank observations live beside operational close, with their source arithmetic intact." />
        <section className="po-deposit-list"><header><span>Location / payout</span><span>Expected</span><span>Observed</span><span>Variance</span><span>Status</span><span /></header>{items.map((payout) => <Link key={payout.id} to={`/app/deposits/${payout.id}`} className={payout.status === 'VARIANCE' ? 'po-deposit-row po-deposit-row--variance' : 'po-deposit-row'}><div><strong>{payoutName(state, payout)}</strong><small>{payout.externalPayoutId ?? 'Current business day'} · {payout.payoutDate}</small></div><span data-label="Expected">{payout.adjustedExpectedCents === null ? '—' : <Money cents={payout.adjustedExpectedCents} />}</span><span data-label="Observed">{payout.observedBankCents === null ? '—' : <Money cents={payout.observedBankCents} />}</span><span data-label="Variance">{payout.varianceCents === null ? '—' : <Money cents={payout.varianceCents} />}</span><span className="po-deposit-row__status"><small>Status</small><Status value={payout.status} compact /></span><Icon name="chevron" /></Link>)}</section>
      </div>;
    }}</WorkspaceGate>
  );
}

export function DepositDetailPage() {
  const { payoutId = '' } = useParams();
  const { recordAdjustment, pendingLabel } = useWorkspace();
  const [note, setNote] = useState('');
  return (
    <WorkspaceGate>{(state) => {
      const payout = state.payouts.find((item) => item.id.toLocaleLowerCase() === payoutId.toLocaleLowerCase());
      if (!payout) return <NotFound title="Deposit not found" />;
      const rooftop = state.rooftops.find((item) => item.id === payout.rooftopId)!;
      const sources = state.payoutSourceRecords.filter((item) => item.payoutId === payout.id);
      const adjustments = state.settlementAdjustments.filter((item) => item.payoutId === payout.id);
      const evidence = sources.find((item) => item.component === 'NETWORK_ASSESSMENT_NOTICE');
      const actionable = payout.id === 'payout_9842' && payout.status === 'VARIANCE' && evidence;
      return <div className="po-page po-deposit-detail">
        <Link className="po-back-link" to="/app/deposits"><span>←</span> Back to Deposits</Link>
        <header className="po-deposit-heading"><div><h1>{rooftop.name}</h1><h2>Daily deposit reconciliation</h2><time className="po-deposit-date" dateTime={payout.payoutDate}><Icon name="calendar" />{businessDateLabel(payout.payoutDate)}</time></div><dl><DetailFact label="Payout">{payout.externalPayoutId ?? 'Pending'}</DetailFact><DetailFact label="Status"><Status value={payout.status} compact /></DetailFact></dl></header>
        {payout.originalExpectedCents === null ? <section className="po-pending-deposit"><Icon name="clock" /><h2>Awaiting processor batch</h2><p>This is normal for the current business day. It does not block the location’s operational close.</p></section> : <div className="po-settlement-layout">
          <section className="po-ledger-card">
            <span className="po-bench-label">Settlement workpaper</span><h2>Payout reconciliation</h2><p>Processor components</p>
            <div className="po-ledger-lines"><div><span>Captured payments</span><Money cents={payout.capturedCents ?? 0} /></div><div><span>Refunds</span><Money cents={-(payout.refundCents ?? 0)} signed /></div><div><span>Processor fees</span><Money cents={-(payout.feeCents ?? 0)} signed /></div>{adjustments.length > 0 && <div><span>Recorded adjustments</span><Money cents={adjustments.reduce((sum, item) => sum + item.amountCents, 0)} signed /></div>}<div className="po-ledger-total"><span>{adjustments.length ? 'Adjusted expected deposit' : 'Expected deposit'}</span><Money cents={payout.adjustedExpectedCents ?? 0} /></div><div className="po-ledger-observed"><span>Observed bank deposit</span><Money cents={payout.observedBankCents ?? 0} /></div><div className={payout.varianceCents === 0 ? 'po-ledger-variance po-ledger-variance--clear' : 'po-ledger-variance'}><span>Variance</span><Money cents={payout.varianceCents ?? 0} /></div></div>
            {adjustments.length > 0 && <p className="po-original-expected">Original expected preserved · <Money cents={payout.originalExpectedCents ?? 0} /></p>}
            <div className="po-source-ledger"><h3>Source evidence</h3>{sources.length ? <><div className="po-source-ledger__head"><span>Component</span><span>Received</span><span>Amount</span></div>{sources.map((source) => <div className="po-source-ledger__row" key={source.id}><span><strong>{sentenceCase(source.component)}</strong><small>{source.description}</small></span><time>{localTime(source.receivedAt)}</time><Money cents={source.amountCents} signed={source.amountCents < 0} /></div>)}</> : <p className="po-source-ledger__empty">No source evidence is available for this payout.</p>}</div>
          </section>
          <section className="po-adjustment-card">
            {actionable ? <><div className="po-variance-alert"><span>!</span><div><small>Unexplained variance</small><h2><Money cents={payout.varianceCents ?? 0} /></h2><p>The observed deposit is below the processor model.</p></div></div><div className="po-variance-detail"><span className="po-bench-label">Variance detail</span><dl><DetailFact label="Expected"><Money cents={payout.adjustedExpectedCents ?? 0} /></DetailFact><DetailFact label="Observed"><Money cents={payout.observedBankCents ?? 0} /></DetailFact><DetailFact label="Supported adjustment"><Money cents={-2500} signed /></DetailFact><DetailFact label="Result"><Money cents={0} /> variance</DetailFact></dl></div><div className="po-evidence-file"><Icon name="document" /><span><small>Evidence found</small><strong>Network assessment notice</strong><em>{evidence.externalEventId}</em></span><Icon name="external" /></div><label className="po-note-field">Controller note <span>Optional</span><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Add context without altering source evidence" /></label><button className="po-button po-button--primary po-button--full" aria-label="Record −$25.00 network assessment adjustment" disabled={Boolean(pendingLabel)} onClick={() => void recordAdjustment(payout.id, payout.version, evidence.id, note || undefined)}>{pendingLabel ?? 'Record supported adjustment'}<Icon name="arrow" /></button><Link className="po-button po-button--quiet po-button--full" to="/app/deposits">Leave unresolved</Link></> : payout.status === 'RECONCILED' ? <div className="po-adjustment-complete" role="status" aria-live="polite"><span><Icon name="check" /></span><h2>Deposit reconciled</h2><p>{adjustments.length ? `Adjustment recorded by ${adjustments.at(-1)?.actor}.` : 'Expected and observed amounts agree.'}</p><Status value="RECONCILED" /></div> : <><h2>No controller action available</h2><p>The immutable source records do not support a settlement adjustment.</p></>}
          </section>
        </div>}
      </div>;
    }}</WorkspaceGate>
  );
}

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  return <WorkspaceGate>{(state) => {
    const actor = params.get('actor') ?? 'ALL';
    const kind = params.get('kind') ?? 'ALL';
    const location = params.get('location') ?? 'ALL';
    const entityType = params.get('entityType') ?? 'ALL';
    const date = params.get('date') ?? 'ALL';
    const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value === 'ALL') next.delete(key); else next.set(key, value); setParams(next); };
    const context = (event: WorkspaceState['auditEvents'][number]) => {
      const payment = state.payments.find((item) => item.id === event.entityId);
      const exception = state.exceptions.find((item) => item.id === event.entityId);
      const close = state.operationalCloses.find((item) => item.id === event.entityId);
      const payout = state.payouts.find((item) => item.id === event.entityId);
      const rooftopId = payment?.rooftopId ?? exception?.rooftopId ?? close?.rooftopId ?? payout?.rooftopId;
      const rooftop = state.rooftops.find((item) => item.id === rooftopId);
      const href = event.entityType === 'payment' ? `/app/payments/${event.entityId}`
        : event.entityType === 'exception' ? `/app/exceptions/${event.entityId}`
          : event.entityType === 'processor_payout' ? `/app/deposits/${event.entityId}` : '/app/close';
      return { rooftop, href };
    };
    const items = [...state.auditEvents].filter((event) => {
      const { rooftop } = context(event);
      return (actor === 'ALL' || event.actor === actor)
        && (kind === 'ALL' || (kind === 'SYSTEM' ? event.actor === 'System' : event.actor !== 'System'))
        && (location === 'ALL' || rooftop?.code === location)
        && (entityType === 'ALL' || event.entityType === entityType)
        && (date === 'ALL' || event.occurredAt.slice(0, 10) === date);
    }).sort((a, b) => b.sequence - a.sequence);
    return <div className="po-page"><PageHeading eyebrow="Immutable audit" title="Activity" description="Human-readable decisions and recovery events, linked back to the business record they affected." /><div className="po-filterbar po-filterbar--activity"><label>Actor<select value={actor} onChange={(event) => update('actor', event.target.value)}><option value="ALL">All actors</option><option value="System">System</option><option value={state.user.name}>{state.user.name}</option></select></label><label>Origin<select value={kind} onChange={(event) => update('kind', event.target.value)}><option value="ALL">System + human</option><option value="SYSTEM">System</option><option value="HUMAN">Human</option></select></label><label>Location<select value={location} onChange={(event) => update('location', event.target.value)}><option value="ALL">All locations</option>{state.rooftops.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label><label>Entity<select value={entityType} onChange={(event) => update('entityType', event.target.value)}><option value="ALL">All entities</option>{[...new Set(state.auditEvents.map((item) => item.entityType))].sort().map((value) => <option key={value} value={value}>{sentenceCase(value)}</option>)}</select></label><label>Date<select value={date} onChange={(event) => update('date', event.target.value)}><option value="ALL">All dates</option><option value={state.metadata.businessDate}>Friday, Sep 4</option></select></label><span className="po-filterbar__count">{items.length} events</span></div><section className="po-activity-list">{items.map((event) => { const { rooftop, href } = context(event); return <article key={event.id}><time>{localTime(event.occurredAt, true)}</time><span className="po-activity-icon"><Icon name={event.type.includes('REJECTED') ? 'exception' : 'activity'} /></span><div><small>{sentenceCase(event.type)}{rooftop ? ` · ${rooftop.code}` : ''}</small><h2>{event.summary}</h2><p>{event.actor}</p></div><Link to={href}>Open record <Icon name="arrow" /></Link></article>; })}{items.length === 0 && <div className="po-empty"><h2>No matching activity</h2><p>Adjust the audit filters to see more events.</p></div>}</section></div>;
  }}</WorkspaceGate>;
}

export function IntegrationsPage() {
  return <WorkspaceGate>{(state) => <div className="po-page"><PageHeading eyebrow="System boundaries" title="Integrations" description="Three connected simulators. Every attempt is sanitized and attached to the operation it supports." /><section className="po-integrations">{state.integrations.map((integration) => { const system = integration.id === 'legacy-dms' ? 'LEGACY_DMS' : integration.id === 'northstar-processor' ? 'NORTHSTAR_PROCESSOR' : 'PRAIRIE_BANK'; const attempts = state.integrationAttempts.filter((item) => item.system === system).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)); return <article key={integration.id}><header><span className="po-integration-mark"><Icon name="integration" /></span><div><h2>{integration.name}</h2><p>{integration.description}</p></div><Status value={integration.status} /></header><dl><DetailFact label="Environment">Synthetic simulator</DetailFact><DetailFact label="Last success">{localTime(integration.lastSuccessfulAt, true)}</DetailFact><DetailFact label="Recorded attempts">{attempts.length}</DetailFact><DetailFact label="Identity guard">{system === 'LEGACY_DMS' ? 'Stable operation key' : system === 'NORTHSTAR_PROCESSOR' ? 'Unique provider event' : 'Payout + source identity'}</DetailFact></dl><details><summary>Recent attempts <Icon name="chevron" /></summary><div className="po-attempts">{attempts.length === 0 && <p className="po-attempts__empty">No attempts recorded yet.</p>}{attempts.slice(0, 8).map((attempt) => <div key={attempt.id}><time>{localTime(attempt.occurredAt)}</time><span>{attempt.operation}</span><Status value={attempt.status} compact /><code>{attempt.correlationId}</code></div>)}</div></details></article>; })}</section><section className="po-matching-policy"><div><span className="po-card-index">Ordered matching policy</span><h2>Deterministic first. Human judgment when evidence diverges.</h2></div><ol><li><b>1</b><span><strong>Exact RO / ticket / deal reference</strong><small>Same location + exact source reference</small></span></li><li><b>2</b><span><strong>Exact invoice reference</strong><small>Same location + reference + amount</small></span></li><li><b>3</b><span><strong>Customer + exact amount</strong><small>Same location + constrained time window</small></span></li><li><b>4</b><span><strong>Candidate only</strong><small>Same customer + nearby amount · human review required</small></span></li></ol></section><aside className="po-principle"><span>Delivery semantics</span><p>Transport is at least once. Stable identities make each domain mutation idempotent; PostOnce does not claim impossible exactly-once network delivery.</p></aside></div>}</WorkspaceGate>;
}

function NotFound({ title = 'Page not found' }: { title?: string }) {
  return <div className="po-page-state"><span className="po-state-mark">404</span><h1>{title}</h1><p>The requested record is not part of this isolated workspace.</p><Link className="po-button po-button--primary" to="/app/close">Return to close</Link></div>;
}

export function ProductApp() {
  return <WorkspaceProvider><ProductShell /></WorkspaceProvider>;
}

export function ProductIndex() {
  return <Navigate to="/app/close" replace />;
}

export function ProductNotFound() {
  return <NotFound />;
}
