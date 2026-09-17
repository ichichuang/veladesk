/**
 * Minimal ambient boot screen: wordmark, one status line, one light pulse.
 * CSS-only motion; `prefers-reduced-motion` stops the loop entirely.
 */
export function StartupScreen() {
  return (
    <main className="vela-boot" role="status">
      <div className="vela-boot__ambient" aria-hidden="true" />
      <div className="vela-boot__content">
        <h1 className="vela-wordmark">VelaDesk</h1>
        <p className="vela-boot__status">Opening your workspace…</p>
        <div className="vela-boot__pulse" aria-hidden="true" />
      </div>
    </main>
  );
}
