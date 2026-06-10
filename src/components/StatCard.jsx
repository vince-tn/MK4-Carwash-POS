export default function StatCard({ title, value, subtext }) {
  return (
    <div className="stat-card">
      <p>{title}</p>
      <h3>{value}</h3>
      {subtext && <span>{subtext}</span>}
    </div>
  );
}