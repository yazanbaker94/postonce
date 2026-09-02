import { Money, Status } from './ui';

const previewRows = [
  { ref: 'RO-8001', name: 'Customer •4821', amount: 45900, state: 'POSTED', tone: 'good' as const },
  { ref: 'RO-8002', name: 'Customer •1974', amount: 73250, state: 'POSTED', tone: 'good' as const },
  { ref: 'RO-8031', name: 'Customer •5004', amount: 49500, state: 'REVIEW', tone: 'warn' as const },
];

export function ClosePreview({ condensed = false }: { condensed?: boolean }) {
  return (
    <article className={`close-preview ${condensed ? 'close-preview--condensed' : ''}`}>
      <div className="close-preview__topline">
        <div><span className="mono-label">FRI / 16:55:02</span><h2>Northline close</h2></div>
        <Status tone="warn">PROCESSING</Status>
      </div>
      <div className="close-preview__scope">
        <span>NL-CENTRAL</span><span>NL-SOUTH</span><span>12 EVENTS</span>
      </div>
      <div className="close-preview__rows">
        {previewRows.map((row) => (
          <div className="close-preview__row" key={row.ref}>
            <span className="record-id">{row.ref}</span>
            <span>{row.name}</span>
            <strong><Money cents={row.amount} /></strong>
            <Status tone={row.tone}>{row.state}</Status>
          </div>
        ))}
      </div>
      <div className="balance-equation">
        <div><span>GROSS</span><strong><Money cents={529950} /></strong></div>
        <i>−</i>
        <div><span>FEES</span><strong><Money cents={14526} /></strong></div>
        <i>−</i>
        <div><span>REFUNDS</span><strong><Money cents={12500} /></strong></div>
        <i>=</i>
        <div className="balance-equation__result"><span>EXPECTED</span><strong><Money cents={502924} /></strong></div>
      </div>
      <div className="close-preview__footer">
        <span className="pulse-dot" /> Waiting on 01 explainable exception
        <span className="record-id">corr_close_8f2a</span>
      </div>
    </article>
  );
}
