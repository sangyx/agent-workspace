import type { WorkspaceSnapshot } from "../shared/types";
import { AccountLimits } from "./components/SessionUsage";
export function HostUsage({
  snapshot,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  onClose: () => void;
}) {
  return (
    <section className="host-usage" aria-label="Usage & limits">
      <header>
        <strong>Usage & limits</strong>
        <button className="btn" onClick={onClose} aria-label="Close usage">
          ×
        </button>
      </header>
      {Object.keys(snapshot.limits ?? {}).length ? (
        <AccountLimits limits={snapshot.limits ?? {}} now={Date.now()} />
      ) : (
        <p className="muted">
          No account-limit data yet. Start a session to refresh provider usage.
        </p>
      )}
    </section>
  );
}
