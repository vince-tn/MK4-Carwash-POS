export default function StatCard({ title, value, subtext, onClick, active }) {
  const clickable = typeof onClick === "function";

  const className = [
    "stat-card",
    clickable ? "clickable" : "",
    active ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <div
      className={className}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
    >
      <p>{title}</p>
      <h3>{value}</h3>
      {subtext && <span>{subtext}</span>}
      {clickable && (
        <small className="stat-expand-hint">
          {active ? "Tap to collapse ▲" : "Tap to expand ▼"}
        </small>
      )}
    </div>
  );
}
