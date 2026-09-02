import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { chapters } from '../demoData';
import { useDemo } from '../hooks/useDemo';
import { countLogicalAttempts } from '../trace';
import type { ChapterDefinition, DemoState, IntegrationAttempt } from '../types';
import { Arrow, JsonView, Mark, Money, Status } from '../components/ui';

type Panel = 'ledger' | 'exceptions' | 'attempts' | 'audit';

const shortId = (value: string) => value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-5)}` : value;
const time = (value: string) => new Intl.DateTimeFormat('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
const statusTone = (status: string): 'good' | 'warn' | 'bad' | 'info' | 'neutral' => {
  if (['READY', 'POSTED', 'PAID', 'RECONCILED', 'REPLAYED', 'ACCEPTED', 'RESOLVED', 'DELIVERED', 'PASS'].includes(status)) return 'good';
  if (['BLOCKED', 'EXCEPTION', 'OPEN', 'RESPONSE_LOST'].includes(status)) return 'warn';
  if (['REJECTED', 'VERSION_CONFLICT'].includes(status)) return 'bad';
  if (['MATCHED', 'PROCESSING', 'RECEIVED', 'COMMITTED'].includes(status)) return 'info';
  return 'neutral';
};

function ConsoleHeader({ state, mode, onReset, resetting }: { state: DemoState; mode: 'api' | 'local'; onReset: () => void; resetting: boolean }) {
  return (
    <header className="console-header">
      <Link to="/" className="console-header__brand"><Mark /></Link>
      <div className="console-header__context">
        <span className="record-id">CONTROL ROOM</span><i />
        <strong>{state.metadata.organization}</strong><i />
        <span>{state.metadata.scenario}</span>
      </div>
      <div className="console-header__actions">
        <Status tone={mode === 'api' ? 'good' : 'warn'}>{mode === 'api' ? 'LIVE API' : 'LOCAL PREVIEW'}</Status>
        <button className="icon-button" onClick={onReset} disabled={resetting || mode === 'local'} title="Reset isolated session" aria-label="Reset isolated session">↻</button>
        <Link className="icon-button" to="/architecture" title="Architecture" aria-label="Read architecture">↗</Link>
      </div>
    </header>
  );
}

function StepRail({ current, onSelect }: { current: number; onSelect: (panel: Panel) => void }) {
  return (
    <aside className="step-rail">
      <div className="step-rail__heading"><span>CLOSE RUN</span><strong>{String(Math.min(current, 6)).padStart(2, '0')} / 06</strong></div>
      <ol>
        {chapters.map((chapter) => {
          const state = chapter.index < current ? 'complete' : chapter.index === current ? 'active' : 'locked';
          return (
            <li key={chapter.id} className={`step-rail__step step-rail__step--${state}`}>
              <span className="step-rail__node">{state === 'complete' ? '✓' : chapter.id}</span>
              <div><span>{chapter.eyebrow.split('/')[0]}</span><strong>{chapter.shortTitle}</strong></div>
            </li>
          );
        })}
      </ol>
      <div className="step-rail__views">
        <span>INSPECT</span>
        <button onClick={() => onSelect('ledger')}>Payment ledger</button>
        <button onClick={() => onSelect('exceptions')}>Exception queue</button>
        <button onClick={() => onSelect('attempts')}>Integration attempts</button>
        <button onClick={() => onSelect('audit')}>Audit trail</button>
      </div>
    </aside>
  );
}

function CloseMetrics({ state }: { state: DemoState }) {
  const processed = state.payments.filter((item) => ['POSTED', 'REFUNDED'].includes(item.status)).length;
  return (
    <div className="metric-strip">
      <div><span>CLOSE STATE</span><Status tone={statusTone(state.close.status)}>{state.close.status}</Status></div>
      <div><span>PROCESSED</span><strong>{String(processed).padStart(2, '0')}<small> / {state.payments.length}</small></strong></div>
      <div><span>BLOCKING</span><strong className={state.close.blockingExceptionCount ? 'text-warn' : ''}>{String(state.close.blockingExceptionCount).padStart(2, '0')}</strong></div>
      <div><span>EXPECTED DEPOSIT</span><strong><Money cents={state.totals.expectedDepositCents} currency={state.totals.currency} /></strong></div>
      <div><span>VARIANCE</span><strong className={state.totals.varianceCents ? 'text-warn' : 'text-good'}><Money cents={state.totals.varianceCents} currency={state.totals.currency} /></strong></div>
    </div>
  );
}

function ChapterHero({ chapter, state, pending, mode, onRun, onRunAll }: { chapter: ChapterDefinition; state: DemoState; pending: string | null; mode: 'api' | 'local'; onRun: () => void; onRunAll: () => void }) {
  const done = state.currentChapter >= chapter.index && chapter.index === 6;
  return (
    <section className="chapter-hero">
      <div className="chapter-hero__index"><span>CHAPTER</span><strong>{chapter.id}</strong></div>
      <div className="chapter-hero__copy">
        <p className="eyebrow">{chapter.eyebrow}</p>
        <h1>{chapter.title}</h1>
        <p>{chapter.body}</p>
        <div className="chapter-hero__proof"><span>PROVES</span>{chapter.proof}</div>
      </div>
      <div className="chapter-hero__action">
        {chapter.action ? (
          <button className="button button--primary" onClick={onRun} disabled={Boolean(pending) || mode === 'local'}>
            {pending === chapter.action ? <><span className="spinner" /> Running</> : <>{chapter.actionLabel} <Arrow /></>}
          </button>
        ) : (
          <div className="ready-stamp"><span>BOOKS</span><strong>{done || state.close.status === 'READY' ? 'READY' : 'PENDING'}</strong><small>VARIANCE / <Money cents={state.totals.varianceCents} /></small></div>
        )}
        {chapter.index < 6 && <button className="button button--text button--compact" onClick={onRunAll} disabled={Boolean(pending) || mode === 'local'}>{pending === 'run-all' ? 'Running close…' : 'Run all chapters →'}</button>}
      </div>
    </section>
  );
}

function PaymentLedger({ state }: { state: DemoState }) {
  const rooftops = new Map(state.rooftops.map((item) => [item.id, item.code]));
  return (
    <section className="data-panel">
      <div className="data-panel__heading"><div><span className="record-id">LEDGER / PAYMENT EVENTS</span><h2>What reached the coordinator</h2></div><span>{state.payments.length} RECORDS</span></div>
      <div className="table-scroll">
        <table className="ledger-table">
          <thead><tr><th>Event</th><th>Customer</th><th>Rooftop</th><th>Repair order</th><th>Amount</th><th>State</th></tr></thead>
          <tbody>{state.payments.map((payment) => (
            <tr key={payment.id} className={payment.status === 'EXCEPTION' ? 'is-attention' : ''}>
              <td><strong>{payment.externalEventId}</strong><small>{time(payment.receivedAt)}</small></td>
              <td>{payment.customerLabel}</td>
              <td><span className="record-id">{rooftops.get(payment.rooftopId) ?? payment.rooftopId}</span></td>
              <td>{payment.reference ?? <span className="missing-value">NO REFERENCE</span>}</td>
              <td><strong><Money cents={payment.amountCents} currency={payment.currency} /></strong></td>
              <td><Status tone={statusTone(payment.status)}>{payment.status}</Status></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function ExceptionQueue({ state }: { state: DemoState }) {
  const exception = state.exceptions[0];
  const payment = state.payments.find((item) => item.id === exception?.paymentId);
  if (!exception) return <EmptyPanel code="EX / 00" title="No exception yet" copy="Continue the close. PostOnce will surface the one payment it cannot allocate deterministically." />;
  return (
    <section className="exception-workbench">
      <div className="exception-workbench__heading">
        <div><span className="record-id">{exception.id.toUpperCase()} / VERSION {exception.version}</span><h2>{exception.title}</h2><p>{exception.summary}</p></div>
        <Status tone={statusTone(exception.status)}>{exception.severity} / {exception.status}</Status>
      </div>
      <div className="exception-payment">
        <span>UNALLOCATED PAYMENT</span><strong>{payment?.customerLabel ?? 'Customer •5004'}</strong><b><Money cents={payment?.amountCents ?? 49500} /></b><code>{payment?.externalEventId ?? 'evt_ns_1009'}</code>
      </div>
      <div className="candidate-grid">
        {exception.candidates.map((candidate, index) => (
          <article key={candidate.invoiceId} className={exception.resolution?.candidateInvoiceId === candidate.invoiceId ? 'is-selected' : ''}>
            <div><span>CANDIDATE {String(index + 1).padStart(2, '0')}</span><strong>{Math.round(candidate.score * 100)}% rule score</strong></div>
            <h3>{candidate.repairOrderNumber}</h3><b><Money cents={candidate.amountCents} /></b>
            <ul>{candidate.reasons.map((reason) => <li key={reason}>✓ {reason}</li>)}</ul>
            {exception.resolution?.candidateInvoiceId === candidate.invoiceId && <Status tone="good">ACCEPTED BY {exception.resolution.actor.toUpperCase()}</Status>}
          </article>
        ))}
      </div>
      <div className="assistant-note"><span>ADVISORY / NO WRITE PERMISSION</span><p>{exception.assistantNote ?? 'Candidate explanations are derived from deterministic signals. A controller owns the decision.'}</p></div>
      {exception.resolution && <div className="resolution-record"><span>RESOLUTION APPENDED</span><p>{exception.resolution.reason}</p><code>{exception.resolution.operationKey}</code></div>}
    </section>
  );
}

function AttemptList({ state, selected, onSelect }: { state: DemoState; selected: string | null; onSelect: (id: string) => void }) {
  if (!state.integrationAttempts.length) return <EmptyPanel code="INT / 00" title="No integration attempts yet" copy="Continue to the duplicate and lost-response chapters to populate a real retry trace." />;
  return (
    <section className="data-panel">
      <div className="data-panel__heading"><div><span className="record-id">INTEGRATIONS / ATTEMPTS</span><h2>Every delivery remains observable</h2></div><span>{state.integrationAttempts.length} ATTEMPTS</span></div>
      <div className="attempt-list">
        {state.integrationAttempts.slice().reverse().map((attempt) => <button key={attempt.id} className={selected === attempt.id ? 'is-selected' : ''} onClick={() => onSelect(attempt.id)}>
          <span className="attempt-list__time">{time(attempt.occurredAt)}</span>
          <span><strong>{attempt.system.replaceAll('_', ' ')}</strong><small>{attempt.operation} / ATTEMPT {attempt.attempt}</small></span>
          <code>{shortId(attempt.operationKey)}</code>
          <Status tone={statusTone(attempt.status)}>{attempt.httpStatus ?? '—'} / {attempt.status}</Status>
        </button>)}
      </div>
    </section>
  );
}

function AuditTrail({ state }: { state: DemoState }) {
  return (
    <section className="data-panel">
      <div className="data-panel__heading"><div><span className="record-id">AUDIT / APPEND-ONLY</span><h2>No silent rewrites</h2></div><span>{state.auditEvents.length} EVENTS</span></div>
      <ol className="audit-trail">
        {state.auditEvents.slice().sort((a, b) => b.sequence - a.sequence).map((event) => <li key={event.id}>
          <span className="audit-trail__node">{String(event.sequence).padStart(2, '0')}</span>
          <span className="audit-trail__time">{time(event.occurredAt)}</span>
          <div><strong>{event.type.replaceAll('_', ' ')}</strong><p>{event.summary}</p><small>{event.actor}</small></div>
          <code>{event.correlationId}</code>
        </li>)}
      </ol>
    </section>
  );
}

function EmptyPanel({ code, title, copy }: { code: string; title: string; copy: string }) {
  return <section className="empty-panel"><span className="record-id">{code}</span><div className="empty-panel__glyph">∅</div><h2>{title}</h2><p>{copy}</p></section>;
}

function EvidenceDrawer({ state, selectedAttempt }: { state: DemoState; selectedAttempt: IntegrationAttempt | undefined }) {
  const chapter = chapters[Math.min(state.currentChapter, 6)] ?? chapters[0]!;
  const evidence = selectedAttempt ?? state.integrationAttempts.at(-1);
  const logicalAttempts = evidence ? countLogicalAttempts(state.integrationAttempts, evidence) : 0;
  return (
    <aside className="evidence-drawer">
      <div className="evidence-drawer__heading"><span>EVIDENCE / {chapter.id}</span><Status tone="info">SANITIZED</Status></div>
      {evidence ? <>
        <div className="evidence-summary">
          <span>{evidence.system.replaceAll('_', ' ')}</span>
          <h3>{evidence.note}</h3>
          <dl><div><dt>OPERATION KEY</dt><dd>{evidence.operationKey}</dd></div><div><dt>CORRELATION</dt><dd>{evidence.correlationId}</dd></div><div><dt>LOGICAL ATTEMPTS IN TRACE</dt><dd data-testid="logical-attempt-count">{logicalAttempts}</dd></div></dl>
        </div>
        <JsonView label="SANITIZED REQUEST" value={evidence.sanitizedRequest} />
        <JsonView label="OBSERVED RESPONSE" value={evidence.sanitizedResponse ?? { transport: 'closed before response', committed: 'unknown to caller' }} />
      </> : <div className="evidence-placeholder"><div className="evidence-placeholder__trace"><i /><i /><i /></div><h3>Evidence arrives with the run.</h3><p>Every request, response, operation key, and correlation ID will appear here—without credentials or payment data.</p></div>}
      <div className="invariant-mini">
        <div><span>DUPLICATE DELIVERIES IGNORED</span><strong>{state.invariants.duplicateDeliveriesIgnored}</strong></div>
        <div><span>DMS ATTEMPTS / MUTATIONS</span><strong>{state.invariants.dmsAttempts} / {state.invariants.dmsMutations}</strong></div>
        <div><span>STALE DECISIONS REJECTED</span><strong>{state.invariants.rejectedVersionConflicts}</strong></div>
      </div>
    </aside>
  );
}

export function DemoConsole() {
  const demo = useDemo();
  const [panel, setPanel] = useState<Panel>('ledger');
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);

  useEffect(() => {
    if (!demo.state) return;
    if (demo.state.currentChapter === 4 || demo.state.currentChapter === 5) setPanel('exceptions');
    if (demo.state.currentChapter === 2 || demo.state.currentChapter === 3) setPanel('attempts');
    if (demo.state.currentChapter === 6) setPanel('audit');
  }, [demo.state?.currentChapter]);

  const selectedAttempt = useMemo(() => demo.state?.integrationAttempts.find((item) => item.id === selectedAttemptId) ?? demo.state?.integrationAttempts.at(-1), [demo.state, selectedAttemptId]);

  if (demo.loading || !demo.state) return <div className="console-loading"><Mark /><div className="console-loading__bar"><i /></div><span>CREATING ISOLATED CLOSE RUN</span></div>;
  const state = demo.state;
  const chapter = chapters[Math.min(state.currentChapter, 6)] ?? chapters[0]!;

  return (
    <div className="console-shell">
      <ConsoleHeader state={state} mode={demo.mode} onReset={() => void demo.reset()} resetting={demo.pendingAction === 'reset'} />
      {demo.mode === 'local' && <div className="service-banner" role="status"><div><strong>Read-only local preview</strong><span>The live API did not answer, so this is seeded interface evidence—no action will pretend to persist.</span></div><button onClick={() => void demo.retryApi()}>Retry live service <Arrow /></button></div>}
      {demo.error && demo.mode === 'api' && <div className="error-banner" role="alert"><strong>{demo.error.code}</strong><span>{demo.error.message}</span>{demo.error.correlationId && <code>{demo.error.correlationId}</code>}</div>}
      <div className="console-layout">
        <StepRail current={state.currentChapter} onSelect={setPanel} />
        <main className="console-main">
          <CloseMetrics state={state} />
          <ChapterHero chapter={chapter} state={state} pending={demo.pendingAction} mode={demo.mode} onRun={() => chapter.action && void demo.run(chapter.action)} onRunAll={() => void demo.run('run-all')} />
          <div className="panel-tabs" role="tablist" aria-label="Close data views">
            {([['ledger', 'Payments'], ['exceptions', `Exceptions ${state.exceptions.filter((item) => item.status === 'OPEN').length ? `(${state.exceptions.filter((item) => item.status === 'OPEN').length})` : ''}`], ['attempts', 'Attempts'], ['audit', 'Audit']] as Array<[Panel, string]>).map(([key, label]) => <button role="tab" aria-selected={panel === key} key={key} onClick={() => setPanel(key)}>{label}</button>)}
          </div>
          {panel === 'ledger' && <PaymentLedger state={state} />}
          {panel === 'exceptions' && <ExceptionQueue state={state} />}
          {panel === 'attempts' && <AttemptList state={state} selected={selectedAttempt?.id ?? null} onSelect={setSelectedAttemptId} />}
          {panel === 'audit' && <AuditTrail state={state} />}
        </main>
        <EvidenceDrawer state={state} selectedAttempt={selectedAttempt} />
      </div>
      <div className="console-disclaimer"><span>SYNTHETIC DATA</span>{state.metadata.disclaimer}<code>SESSION / {shortId(state.session.id)}</code></div>
    </div>
  );
}
