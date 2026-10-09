export default function SeasonTrophy({ rank }: { rank: number }) {
  if (rank > 3) return null;
  const names = ["Gold", "Silver", "Bronze"];
  return (
    <span
      className={`season-trophy season-trophy-${rank}`}
      aria-label={`${names[rank - 1]} trophy`}
      title={`${names[rank - 1]} trophy`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h10v3h3v2a5 5 0 0 1-5 4.9A5 5 0 0 1 13 15.58V19h3v2H8v-2h3v-3.42A5 5 0 0 1 9 12.9 5 5 0 0 1 4 8V6h3V3Zm10 5v2.73A3 3 0 0 0 18 8h-1ZM6 8a3 3 0 0 0 1 2.73V8H6Z" />
      </svg>
    </span>
  );
}
