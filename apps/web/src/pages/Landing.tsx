import { Link } from 'react-router-dom';
import { ClosePreview } from '../components/ClosePreview';
import { Arrow, Mark, SiteFooter, SiteHeader, Status } from '../components/ui';

const failureRows = [
  ['F-01', 'Webhook repeats', 'Accept every delivery. Apply one mutation.', '2 deliveries / 1 event'],
  ['F-02', 'Response disappears', 'Retry with the same destination key.', '2 attempts / 1 posting'],
  ['F-03', 'Match is uncertain', 'Expose candidates. Refuse to guess.', '0 silent allocations'],
  ['F-04', 'Humans race', 'Accept one version. Return the winner.', '200 accepted / 409 stale'],
];

export function Landing() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main>
        <section className="hero ruled-section">
          <div className="hero__copy">
            <div className="eyebrow"><span>INTEGRATION RELIABILITY</span><i /><span>SYNTHETIC CLOSE / CALGARY</span></div>
            <h1>Every payment<br />posts <em>once.</em><br />Every exception<br />stays explainable.</h1>
            <p className="hero__lede">A working engineering case study for the difficult space between a payment processor, a dealership system, and the bank deposit.</p>
            <div className="hero__actions">
              <Link to="/demo" className="button button--primary">Run the close <Arrow /></Link>
              <Link to="/architecture" className="button button--text">Inspect the engineering <Arrow /></Link>
            </div>
            <div className="hero__meta">
              <div><strong>~90 SEC</strong><span>Guided reviewer path</span></div>
              <div><strong>06</strong><span>Deterministic chapters</span></div>
              <div><strong>00</strong><span>Real payment records</span></div>
            </div>
          </div>
          <div className="hero__visual">
            <div className="hero__annotation hero__annotation--top">LIVE STATE / ISOLATED PER BROWSER <Arrow direction="down" /></div>
            <ClosePreview />
            <div className="hero__annotation hero__annotation--bottom"><Arrow direction="up" /> Not a dashboard mockup. Every control calls the demo API.</div>
          </div>
        </section>

        <section className="system-boundary">
          <div className="section-index">01 / THE BOUNDARY</div>
          <div className="system-boundary__intro">
            <p className="eyebrow">THE PROBLEM IS BETWEEN SYSTEMS</p>
            <h2>Payment approved is not the same as books reconciled.</h2>
            <p>One system knows the invoice. Another knows the card cleared. A third knows what reached the bank. PostOnce proves the coordination layer in between.</p>
          </div>
          <div className="boundary-diagram" aria-label="Integration path from dealership system through PostOnce to processor and bank">
            <article>
              <span className="system-code">SYS / 01</span>
              <div className="system-icon system-icon--dms" aria-hidden="true"><i /><i /><i /></div>
              <h3>LegacyDMS</h3><p>Invoices + repair orders</p>
            </article>
            <div className="boundary-link"><span>READ</span><i /><Arrow /></div>
            <article className="boundary-diagram__core">
              <span className="system-code">COORD / P1</span>
              <Mark compact />
              <h3>PostOnce</h3><p>Match, post, explain</p>
            </article>
            <div className="boundary-link"><span>WRITE / VERIFY</span><i /><Arrow /></div>
            <div className="boundary-diagram__destinations">
              <article><span className="system-code">SYS / 02</span><h3>Northstar</h3><p>Processor events</p></article>
              <article><span className="system-code">SYS / 03</span><h3>Prairie Bank</h3><p>Net deposit</p></article>
            </div>
          </div>
          <p className="synthetic-note"><span>*</span> All organizations, transactions, endpoints, and identities shown here are fictional.</p>
        </section>

        <section className="failure-section ruled-section">
          <div className="section-index">02 / FAILURE REGISTER</div>
          <div className="failure-section__title">
            <p className="eyebrow">DESIGNED PAST THE HAPPY PATH</p>
            <h2>The failure is part of the product.</h2>
            <p>A reliable integration does not promise the network behaves. It makes every retry, uncertainty, and competing decision safe and visible.</p>
          </div>
          <div className="failure-register">
            <div className="failure-register__head"><span>CONDITION</span><span>PRODUCT RESPONSE</span><span>PROOF</span></div>
            {failureRows.map(([id, title, response, proof]) => (
              <div className="failure-register__row" key={id}>
                <span className="record-id">{id}</span>
                <strong>{title}</strong>
                <p>{response}</p>
                <code>{proof}</code>
              </div>
            ))}
          </div>
        </section>

        <section className="walkthrough">
          <div className="section-index">03 / THE CLOSE RUN</div>
          <div className="walkthrough__heading">
            <p className="eyebrow">ONE CLOSE / SIX CHECKPOINTS</p>
            <h2>Follow one synthetic day<br />from import to proof.</h2>
          </div>
          <ol className="chapter-grid">
            {[
              ['01', 'Routine', 'Exact references allocate automatically.'],
              ['02', 'Repeat', 'A duplicate webhook becomes evidence.'],
              ['03', 'Recover', 'A lost response returns the original result.'],
              ['04', 'Escalate', 'An uncertain match reaches a human.'],
              ['05', 'Protect', 'A stale decision cannot overwrite history.'],
              ['06', 'Close', 'Ledger and bank deposit balance exactly.'],
            ].map(([number, label, copy]) => <li key={number}><span>{number}</span><h3>{label}</h3><p>{copy}</p></li>)}
          </ol>
          <div className="walkthrough__cta">
            <div><Status tone="good">LIVE DEMO READY</Status><p>Your run is private to this browser and safe to reset.</p></div>
            <Link to="/demo" className="button button--primary">Start at 4:55 PM <Arrow /></Link>
          </div>
        </section>

        <section className="engineering-band">
          <div className="engineering-band__headline">
            <span className="section-index">04 / ENGINEERING EVIDENCE</span>
            <h2>Not exactly-once delivery.<br /><em>Exactly-once effect.</em></h2>
          </div>
          <div className="engineering-band__grid">
            <article><span>DB / 01</span><h3>Transactional inbox + outbox</h3><p>Receive at least once. Commit the domain mutation and outbound intent in one PostgreSQL transaction.</p></article>
            <article><span>API / 02</span><h3>Stable operation identity</h3><p>Retries retain their key, correlation ID, sanitized request, and every observed response.</p></article>
            <article><span>CON / 03</span><h3>Optimistic concurrency</h3><p>An exception version turns a silent last-write-wins bug into a visible 409 decision.</p></article>
            <article><span>TST / 04</span><h3>Reproducible evidence</h3><p>Unit, integration, race, browser, and lookup benchmark checks live beside the product.</p></article>
          </div>
          <Link to="/architecture" className="engineering-band__link">Read the architecture and tradeoffs <Arrow /></Link>
        </section>

        <section className="closing-cta ruled-section">
          <span className="record-id">FINAL / HANDOFF</span>
          <h2>The ledger can explain<br />every dollar and every retry.</h2>
          <div>
            <p>Open the control room, create an isolated run, and break the happy path on purpose.</p>
            <Link to="/demo" className="button button--primary">Run PostOnce <Arrow /></Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
