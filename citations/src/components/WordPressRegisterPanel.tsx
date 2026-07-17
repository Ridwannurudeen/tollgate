export function WordPressRegisterPanel() {
  return (
    <div className="source-registry">
      <div className="panel-heading">
        <p className="eyebrow">wordpress publisher setup</p>
        <h3>Request an operator-issued site key</h3>
      </div>
      <div className="register-source-form">
        <p className="hero-text">
          WordPress registration binds one site URL, payout wallet, and approved
          price. Send those values to the Tollgate operator, then paste the
          one-time site key they return into Settings -&gt; Tollgate.
        </p>
        <p className="status-line source-status">
          The operator authorizes registration with a server-held capability.
          Never paste that capability into this page, WordPress, or another
          browser form.
        </p>
      </div>
    </div>
  );
}
