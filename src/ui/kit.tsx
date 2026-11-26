import type { ReactNode } from 'react';

/** What a card is about. Each kind has its own clear colour (bar + status line), so cards are told apart at a glance. */
export type CardKind = 'vorschlag' | 'frist' | 'warten' | 'termin' | 'person' | 'aufgabe';

export const KIND_LABEL: Record<CardKind, string> = {
  vorschlag: 'Vorschlag', frist: 'Frist', warten: 'Wartet auf Antwort', termin: 'Termin', person: 'Person', aufgabe: 'Aufgabe',
};

export function Card({ children, tone, kind }: { children: ReactNode; tone?: 'accent' | 'warn' | 'quiet'; kind?: CardKind }) {
  return <div className={`card ${tone ?? ''} ${kind ? `k-${kind}` : ''}`}>{children}</div>;
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
