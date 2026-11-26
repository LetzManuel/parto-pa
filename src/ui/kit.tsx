import type { ReactNode } from 'react';

export function Card({ children, tone }: { children: ReactNode; tone?: 'accent' | 'warn' | 'quiet' }) {
  return <div className={`card ${tone ?? ''}`}>{children}</div>;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`chip ${active ? 'on' : ''}`} onClick={onClick}>{children}</button>;
}
