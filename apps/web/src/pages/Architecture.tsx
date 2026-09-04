import { Link } from 'react-router-dom';
import { Arrow, SiteFooter, SiteHeader, Status } from '../components/ui';

const invariants = [
  ['INV-01', 'Provider event identity', 'UNIQUE(provider, external_event_id)', 'A repeated webhook returns its recorded outcome.'],
  ['INV-02', 'Allocation ceiling', 'allocated ≤ payment ∧ invoice', 'A payment cannot overrun either remaining balance.'],
  ['INV-03', 'Stable destination key', 'retry.key = original.key', 'A lost response triggers lookup, not another posting.'],
  ['INV-04', 'Versioned resolution', 'expected_version = current_version', 'The stale controller sees the winner instead of overwriting.'],
  ['INV-05', 'Operational close gate', 'verified = payments ∧ blockers = 0', 'A location can close while its payout is still pending.'],
];

export function Architecture() {
  return (
    <div className="site-shell architecture-page">
      <SiteHeader />
      <main>
        <section className="architecture-hero ruled-section">
          <div>
            <p className="eyebrow">ARCHITECTURE / TRADEOFF RECORD</p>
            <h1>Delivery is at least once.<br /><em>The financial effect is once.</em></h1>
          </div>
          <div className="architecture-hero__aside">
            <p>PostOnce does not claim a network guarantee it cannot provide. It composes database constraints, operation identity, append-only evidence, and human-visible uncertainty.</p>
            <Link to="/app/close" className="button button--primary">Open the workspace <Arrow /></Link>
          </div>
        </section>

        <section className="architecture-map">
          <div className="section-index">01 / SYSTEM PATH</div>
          <div className="architecture-map__canvas">
            <article className="arch-node arch-node--external"><span>IN / HTTP</span><h2>Northstar</h2><p>At-least-once processor webhooks</p><code>evt_ns_1001</code></article>
            <div className="arch-rail"><span>AUTH → VALIDATE</span><i /><Arrow /></div>
            <article className="arch-node arch-node--core"><span>NODE / NESTJS</span><h2>Command boundary</h2><p>Validate command, claim event identity, run transaction.</p><code>corr_3dfcb7a4_routine</code></article>
            <div className="arch-rail"><span>ONE TX</span><i /><Arrow /></div>
            <article className="arch-node arch-node--database"><span>POSTGRESQL</span><h2>Ledger + intent</h2><p>Inbox, allocation, audit, and outbox commit together.</p><code>COMMIT 004218</code></article>
            <div className="arch-rail"><span>LEASE → RETRY</span><i /><Arrow /></div>
            <article className="arch-node arch-node--external"><span>OUT / HTTP</span><h2>LegacyDMS</h2><p>Destination lookup by stable operation key</p><code>op_3dfcb7a4_pay_1001</code></article>
          </div>
          <div className="architecture-map__legend"><span><i className="legend-core" />Owned boundary</span><span><i className="legend-external" />Fictional external simulator</span><span><i className="legend-state" />Durable state</span></div>
        </section>

        <section className="transaction-section ruled-section">
          <div className="section-index">02 / TRANSACTIONAL CORE</div>
          <div className="transaction-section__copy">
            <p className="eyebrow">THE SMALL ATOMIC UNIT</p>
            <h2>One transaction records what happened and what must happen next.</h2>
            <p>If the process dies after commit, the outbox remains. If it dies before commit, none of the partial state exists.</p>
          </div>
          <div className="transaction-stack">
            <div><span>01</span><strong>Claim inbox receipt</strong><code>provider + event_id</code></div>
            <div><span>02</span><strong>Append allocation</strong><code>integer minor units</code></div>
            <div><span>03</span><strong>Append audit event</strong><code>actor + correlation</code></div>
            <div><span>04</span><strong>Enqueue DMS intent</strong><code>stable operation_key</code></div>
            <p><span>COMMIT</span> All four records become durable together.</p>
          </div>
        </section>

        <section className="invariant-section">
          <div className="section-index">03 / INVARIANTS</div>
          <div className="invariant-section__heading"><p className="eyebrow">RULES THAT OUTLIVE REQUESTS</p><h2>Correctness lives in constraints,<br />not good intentions.</h2></div>
          <div className="invariant-table">
            <div className="invariant-table__head"><span>ID / RULE</span><span>ENFORCEMENT</span><span>OBSERVABLE RESULT</span></div>
            {invariants.map(([id, title, rule, result]) => <div className="invariant-table__row" key={id}><span className="record-id">{id}</span><strong>{title}</strong><code>{rule}</code><p>{result}</p></div>)}
          </div>
        </section>

        <section className="race-section">
          <div className="section-index">04 / CONCURRENCY</div>
          <div className="race-section__visual">
            <div className="race-request race-request--maya"><span>MAYA / VERSION 1</span><strong>Resolve EX-104 → RO-8004</strong><i /></div>
            <div className="race-lock"><span>EX-104</span><strong>V1 → V2</strong><small>COMPARE + SWAP</small></div>
            <div className="race-request race-request--jon"><span>STALE CLIENT / VERSION 1</span><strong>Resolve EX-104 → RO-8031</strong><i /></div>
            <div className="race-result race-result--accepted"><Status tone="good">HTTP 200</Status><strong>Maya’s decision appended</strong></div>
            <div className="race-result race-result--rejected"><Status tone="bad">HTTP 409</Status><strong>Stale client receives the winner</strong></div>
          </div>
          <div className="race-section__copy">
            <p className="eyebrow">NO LAST-WRITE-WINS</p>
            <h2>A stale decision becomes evidence.</h2>
            <p>If two clients submit version 1, the first verified decision wins. A stale browser reloads that winning record instead of overwriting it.</p>
            <p className="race-disclosure"><span>CONCURRENCY PROOF</span>An integration test sends two concurrent HTTP commands against PostgreSQL and asserts one 200 winner and one structured 409 conflict.</p>
          </div>
        </section>

        <section className="verification-section ruled-section">
          <div className="section-index">05 / VERIFICATION</div>
          <div className="verification-section__heading"><p className="eyebrow">EXECUTABLE EVIDENCE</p><h2>The same unhappy paths run in tests.</h2></div>
          <div className="verification-grid">
            <article><span>UNIT</span><strong>Domain invariants</strong><p>Money bounds, rule confidence, operation identity, close gating.</p><Status tone="good">AUTOMATED</Status></article>
            <article><span>INTEGRATION</span><strong>Database boundaries</strong><p>Unique claims, transaction rollback, inbox and outbox state.</p><Status tone="good">AUTOMATED</Status></article>
            <article><span>RACE</span><strong>Concurrent resolution</strong><p>Two version-1 commands; one accepted, one structured 409.</p><Status tone="good">DETERMINISTIC</Status></article>
            <article><span>BROWSER</span><strong>Controller journey</strong><p>Three exception decisions, verified posting, operational close, payout adjustment, refresh, and reset.</p><Status tone="good">PLAYWRIGHT</Status></article>
            <article className="verification-grid__benchmark"><span>BENCHMARK / 50,000 RECORDS</span><strong>Indexed reference lookup</strong><div><b>O(1) expected</b><i /><small>vs O(n) sequential scan</small></div><p>Synthetic deterministic fixture. Reported as engineering evidence—not a production performance claim.</p></article>
          </div>
        </section>

        <section className="decision-section">
          <div className="section-index">06 / DECISIONS</div>
          <div className="decision-grid">
            <article><span>ADR / 001</span><h3>REST commands over GraphQL</h3><p>The workflow is a small set of explicit state transitions. HTTP methods and 409 semantics make those boundaries obvious.</p></article>
            <article><span>ADR / 002</span><h3>PostgreSQL before a queue product</h3><p>The database is already the consistency boundary. An outbox relay adds fewer moving parts while preserving recovery.</p></article>
            <article><span>ADR / 003</span><h3>Deterministic rules before AI</h3><p>Money movement needs reproducible reasons. The assistant may explain candidates; it has no ledger write capability.</p></article>
            <article><span>ADR / 004</span><h3>Integer cents everywhere</h3><p>No floating-point financial arithmetic. Currency is explicit at every record and API boundary.</p></article>
          </div>
        </section>

        <section className="architecture-cta">
          <div><span className="record-id">NEXT / BREAK IT SAFELY</span><h2>See each decision under pressure.</h2></div>
          <Link to="/app/close" className="button button--primary">Open daily close <Arrow /></Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
