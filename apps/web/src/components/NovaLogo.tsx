export function NovaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] bg-[var(--accent-solid)] text-[var(--text-on-accent)] font-bold text-[13px] shadow-sm"
      >
        ◆
      </span>
      {!compact ? (
        <span className="font-semibold tracking-tight text-[var(--text-primary)] text-[15px]">
          NOVA STUDIO
        </span>
      ) : null}
    </span>
  );
}
