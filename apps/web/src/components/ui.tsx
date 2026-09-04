import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

export function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="PostOnce">
      <span className="brand__mark" aria-hidden="true"><b>P</b><i>/</i><b>1</b></span>
      {!compact && <span className="brand__word">POST<span>ONCE</span></span>}
    </span>
  );
}

export function Arrow({ direction = 'right' }: { direction?: 'right' | 'down' | 'up' }) {
  return <span className={`arrow arrow--${direction}`} aria-hidden="true">→</span>;
}

export function Money({ cents, currency = 'CAD', signed = false }: { cents: number; currency?: string; signed?: boolean }) {
  const formatted = new Intl.NumberFormat('en-CA', {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2,
  }).format(Math.abs(cents) / 100);
  return <>{signed && cents < 0 ? '−' : signed && cents > 0 ? '+' : ''}{formatted}</>;
}

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'info' | 'neutral' }) {
  return <span className={`status status--${tone}`}><span className="status__dot" />{children}</span>;
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link to="/" className="site-header__brand"><Mark /></Link>
      <nav className="site-nav" aria-label="Primary navigation">
        <NavLink to="/" end>Case study</NavLink>
        <NavLink to="/architecture">Architecture</NavLink>
        <Link to="/app/close" className="button button--small button--ink">Open workspace <Arrow /></Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div><Mark /><p>Independent engineering case study by Yazan Baker.</p></div>
      <div className="site-footer__note">
        <span>SYNTHETIC DATA ONLY</span>
        <p>Not affiliated with a dealership, DMS, processor, bank, or target employer. No real payment data.</p>
      </div>
      <div className="site-footer__links">
        <Link to="/app/close">Run the close</Link>
        <Link to="/architecture">Technical evidence</Link>
        <a href="https://github.com/yazanbaker94/postonce" target="_blank" rel="noreferrer">Source ↗</a>
      </div>
    </footer>
  );
}

export function JsonView({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="json-view">
      <div className="json-view__bar"><span>{label}</span><span>JSON / SANITIZED</span></div>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function ScreenReaderText({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
