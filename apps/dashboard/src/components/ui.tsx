import { useState, type ReactNode } from 'react';

export function Card({ title, eyebrow, actions, children, className = '' }: {
  title?: ReactNode; eyebrow?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="section-head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  SETTLED: 'settled', FAILED: 'failed', SETTLEMENT_PENDING: 'settlement_pending',
  IN_FLIGHT: 'in_flight', AWAITING_SIGNATURE: 'awaiting', PENDING: 'pending',
  DELIVERED: 'settled', CONFIRMED: 'settled', SUBMITTED: 'in_flight',
};

export function StatusTag({ status }: { status: string }) {
  const cls = STATUS_CLASS[status] ?? 'pending';
  return <span className={`status-tag ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

export function EmptyState({ message }: { message: string }) {
  return <p className="empty">{message}</p>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status">{label}</div>;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="link-btn copy-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

export function Pagination({ page, total, limit, onChange }: {
  page: number; total: number; limit: number; onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <button type="button" className="link-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
      <span className="muted">Page {page} of {pages} · {total} total</span>
      <button type="button" className="link-btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next ›</button>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="notice notice-error" role="alert">{message}</div>;
}