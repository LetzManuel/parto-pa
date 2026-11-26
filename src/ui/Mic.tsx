/** The one big microphone. Teal when listening, pulses while PA speaks. */
export function MicButton({ active, busy, onClick, label }: { active?: boolean; busy?: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" className={`mic ${active ? 'on' : ''} ${busy ? 'busy' : ''}`} onClick={onClick} aria-label={label ?? (active ? 'Zuhören beenden' : 'Sprechen')}>
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" />
      </svg>
    </button>
  );
}
