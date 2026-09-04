import { Link } from 'react-router-dom';
import '../landing.css';

const operationalStates = [
  { label: 'Duplicate delivery', state: 'Absorbed', tone: 'blue', glyph: 'shield' },
  { label: 'Lost response', state: 'Recovered', tone: 'amber', glyph: 'triangle' },
  { label: 'Ambiguous allocation', state: 'Escalated', tone: 'coral', glyph: 'square' },
  { label: 'Bank deposit', state: 'Reconciled', tone: 'green', glyph: 'ring' },
  { label: 'Evidence attached to', state: 'Every decision', tone: 'blue', glyph: 'check' },
] as const;

const evidenceStages = [
  { step: '01', label: 'Intake', time: '10:21:11', title: 'Payment received', detail: 'Provider · evt_ns_1001' },
  { step: '02', label: 'Decide', time: '10:21:12', title: 'Exact reference', detail: 'Rule · AR Allocation v4' },
  { step: '03', label: 'Post', time: '10:21:12', title: 'Ledger mutation', detail: 'Entry · SL-8871' },
  { step: '04', label: 'Evidence', time: '10:21:13', title: 'Audit appended', detail: 'Actor · correlation · result' },
  { step: '05', label: 'Done', time: '10:21:13', title: 'Effect committed', detail: 'Result · Posted once' },
] as const;

function BrandLogo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`home-brand${inverse ? ' home-brand--inverse' : ''}`} aria-label="PostOnce">
      <span className="home-brand__crop" aria-hidden="true">
        <img src="/assets/home/postonce-logo-lockup.webp" alt="" width="1024" height="251" />
      </span>
    </span>
  );
}

function MarketingHeader() {
  return (
    <header className="home-header">
      <Link to="/case-study" className="home-header__brand" aria-label="PostOnce case study"><BrandLogo /></Link>
      <nav className="home-nav" aria-label="Primary navigation">
        <a href="#how-it-works">Platform</a>
        <a href="#how-it-works">How it works</a>
        <a href="#evidence">Evidence</a>
        <Link to="/architecture">Architecture</Link>
        <a href="https://github.com/yazanbaker94/postonce" target="_blank" rel="noreferrer">Source ↗</a>
        <Link to="/app/close" className="home-button home-button--primary home-button--nav">Run the close <span aria-hidden="true">→</span></Link>
      </nav>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="home-footer">
      <div className="home-footer__brand">
        <BrandLogo inverse />
        <p>Failure-safe payment posting and reconciliation for teams that close the books.</p>
      </div>
      <nav className="home-footer__links" aria-label="Platform links">
        <strong>Platform</strong>
        <a href="#how-it-works">How it works</a>
        <Link to="/app/close">Daily close</Link>
        <a href="#evidence">Evidence</a>
      </nav>
      <nav className="home-footer__links" aria-label="Project links">
        <strong>Project</strong>
        <Link to="/architecture">Architecture</Link>
        <a href="https://github.com/yazanbaker94/postonce" target="_blank" rel="noreferrer">Source code ↗</a>
      </nav>
      <div className="home-footer__facts">
        <strong>Scope</strong>
        <span>Engineering case study</span>
        <span>Synthetic data</span>
        <span>No payment data</span>
      </div>
      <div className="home-footer__disclaimer">
        <strong>Independent engineering case study</strong>
        <p>All organizations, transactions, endpoints, and identities are fictional. No real payment data.</p>
      </div>
      <div className="home-footer__base">
        <span>© 2026 PostOnce · Synthetic product environment.</span>
        <span>Synthetic data only</span>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <div className="marketing-home">
      <MarketingHeader />
      <main>
        <section className="home-hero" aria-labelledby="home-hero-title">
          <div className="home-hero__copy">
            <h1 id="home-hero-title"><span>Every payment</span><br /><span>posts once.</span><br /><em>Every exception</em><br /><em>stays explainable.</em></h1>
            <p className="home-hero__lede">PostOnce makes each financial effect idempotent across unreliable systems so your close finishes clean and your audit never starts from scratch.</p>
            <div className="home-actions">
              <Link to="/app/close" className="home-button home-button--primary">Run the close <span aria-hidden="true">→</span></Link>
              <Link to="/app/close" className="home-button home-button--text">Explore the workspace <span aria-hidden="true">→</span></Link>
            </div>
          </div>

          <div className="home-hero__art" aria-label="PostOnce routing payments through evidence and exception paths">
            <div className="home-hero__blueprint" aria-hidden="true" />
            <img
              src="/assets/home/hero-switchyard-1254.webp"
              srcSet="/assets/home/hero-switchyard-640.webp 640w, /assets/home/hero-switchyard-960.webp 960w, /assets/home/hero-switchyard-1254.webp 1254w"
              sizes="(max-width: 760px) 640px, (max-width: 1080px) 900px, (max-width: 1600px) 72vw, 1040px"
              alt="A physical routing model showing payment records entering PostOnce and leaving as evidence, exceptions, or review decisions"
              width="1254"
              height="1254"
              fetchPriority="high"
            />
          </div>
        </section>

        <section className="home-state-strip" aria-label="Operational state guarantees">
          {operationalStates.map((item) => (
            <div className="home-state" key={item.label}>
              <span className={`home-state__glyph home-state__glyph--${item.tone} home-state__glyph--${item.glyph}`} aria-hidden="true" />
              <span><small>{item.label}</small><strong>{item.state}</strong></span>
            </div>
          ))}
        </section>

        <section className="home-flow" id="how-it-works" aria-labelledby="home-flow-title">
          <div className="home-flow__inner">
            <div className="home-flow__copy">
              <p className="home-kicker home-kicker--dark">How one payment moves</p>
              <h2 id="home-flow-title">From uncertainty<br />to verified.</h2>
              <p>PostOnce routes each payment through a failure-safe path. Signals may fail, but the financial effect is controlled, recorded, and provable.</p>
              <Link to="/architecture" className="home-inline-link home-inline-link--dark">See the full flow <span aria-hidden="true">→</span></Link>
            </div>
            <div className="home-flow__art">
              <span className="home-flow__swipe" aria-hidden="true">Swipe to trace the full flow →</span>
              <img
                src="/assets/home/process-flow-dark-1672.webp"
                srcSet="/assets/home/process-flow-dark-768.webp 768w, /assets/home/process-flow-dark-1280.webp 1280w, /assets/home/process-flow-dark-1672.webp 1672w"
                sizes="(max-width: 760px) 720px, (max-width: 900px) calc(100vw - 96px), (max-width: 1600px) 75vw, 1080px"
                alt="Five-stage PostOnce flow from intake through proof, with failures rerouted to recovery and escalation"
                width="1672"
                height="941"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </section>

        <section className="home-control-plane" aria-labelledby="home-control-plane-title">
          <div className="home-control-plane__copy">
            <p className="home-kicker">Failures are first-class</p>
            <h2 id="home-control-plane-title">Built for the<br />real world.</h2>
            <p>Networks drop. Systems time out. Files arrive twice. We expect it—so your books don’t suffer for it.</p>
            <Link to="/architecture" className="home-inline-link">See how failures are handled <span aria-hidden="true">→</span></Link>
          </div>
          <div className="home-control-plane__art">
            <img
              src="/assets/home/control-plane-routing-1672.webp"
              srcSet="/assets/home/control-plane-routing-768.webp 768w, /assets/home/control-plane-routing-1280.webp 1280w, /assets/home/control-plane-routing-1672.webp 1672w"
              sizes="(max-width: 760px) calc(116vw - 44px), (max-width: 900px) calc(100vw - 96px), (max-width: 1600px) 76vw, 1080px"
              alt="PostOnce control plane routing API, bank, gateway, and file inputs into posted, pending, and exception outcomes"
              width="1672"
              height="941"
              loading="lazy"
              decoding="async"
            />
          </div>
        </section>

        <section className="home-evidence" id="evidence" aria-labelledby="home-evidence-title">
          <div className="home-evidence__intro">
            <p className="home-kicker">Proof, not promises</p>
            <h2 id="home-evidence-title">Every decision<br />leaves a trail.</h2>
            <p>Every post, route, retry, and rule is captured as immutable evidence—ready for audit, reconciliation, and you.</p>
            <Link to="/app/payments/PAY-1017" className="home-inline-link">Inspect the evidence <span aria-hidden="true">→</span></Link>
          </div>
          <div className="home-proof-rail" aria-label="Example payment evidence sequence">
            <div className="home-proof-rail__heading"><strong>Proof rail</strong><span>corr_close_7a4</span></div>
            <ol>
              {evidenceStages.map((stage, index) => (
                <li key={stage.step}>
                  <span className={`home-proof-rail__node${index === evidenceStages.length - 1 ? ' is-complete' : ''}`}>{index === evidenceStages.length - 1 ? '✓' : stage.step}</span>
                  <div><strong>{stage.label}</strong><time>{stage.time}</time></div>
                  <p>{stage.title}</p>
                  <small>{stage.detail}</small>
                </li>
              ))}
            </ol>
            <Link to="/app/payments/PAY-1017" className="home-proof-rail__action">View full evidence bundle <span aria-hidden="true">→</span></Link>
          </div>
        </section>

        <section className="home-control-room" aria-labelledby="home-control-room-title">
          <div className="home-control-room__copy">
            <p className="home-kicker">Close with confidence</p>
            <h2 id="home-control-room-title">Watch the close<br />prove itself.</h2>
            <p>Follow the Friday close from payment arrival through failure, recovery, evidence, and settlement.</p>
            <Link to="/app/close" className="home-inline-link">Explore the workspace <span aria-hidden="true">→</span></Link>
          </div>
          <div className="home-control-room__placeholder" aria-hidden="true">
            <span className="home-control-room__placeholder-mark" />
          </div>
        </section>

        <section className="home-final-cta" aria-labelledby="home-final-title">
          <h2 id="home-final-title">Payments will fail.<br />Your close doesn't have to.</h2>
          <div>
            <Link to="/app/close" className="home-button home-button--light">Run the close <span aria-hidden="true">→</span></Link>
            <Link to="/app/payments/PAY-1017" className="home-inline-link home-inline-link--dark">Inspect the evidence <span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
