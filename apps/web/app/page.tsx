const principles = [
  "Server-first",
  "Accessible",
  "Mobile-friendly",
  "Cost-conscious"
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Phase 0 scaffold</p>
        <h1 id="page-title">Campus Gaming Network</h1>
        <p className="lede">
          A central hub for collegiate gamers to discover schools, events,
          teams, and campus gaming activity.
        </p>
        <div className="actions" aria-label="Phase 0 health checks">
          <a href="/api/health">Check BFF health</a>
          <a href="http://localhost:8080/health">Check Go API health</a>
        </div>
      </section>

      <section className="panel" aria-labelledby="principles-title">
        <h2 id="principles-title">Build principles</h2>
        <ul>
          {principles.map((principle) => (
            <li key={principle}>{principle}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
