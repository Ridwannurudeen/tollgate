export function JellyfinRegisterPanel() {
  return (
    <div className="source-registry">
      <div className="panel-heading">
        <p className="eyebrow">jellyfin server setup</p>
        <h3>Request an operator-issued webhook key</h3>
      </div>
      <div className="register-source-form">
        <p className="hero-text">
          Jellyfin item registration is operator-approved because it binds a
          media item to a payout wallet. Send the server name, Jellyfin item ID,
          creator name, payout wallet, and per-minute price to the Tollgate
          operator.
        </p>
        <p className="status-line source-status">
          The operator creates the mapping with a server-held registration
          capability and returns a one-time webhook key. Never paste that
          capability into this page or another browser form.
        </p>
      </div>
    </div>
  );
}
