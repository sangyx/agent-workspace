import { useState } from "react";
import type { WorkspaceMessage } from "./workspaceChat";
import { Icon, useChatHost } from "./host";

export function ChatContextNote({
  notes,
}: {
  notes: NonNullable<WorkspaceMessage["contextNotes"]>;
}) {
  const { tx } = useChatHost();
  const [open, setOpen] = useState(false);
  return (
    <details
      className="chat-context-note"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <Icon name="info" size={14} />
        {tx(
          notes.some((note) => note.kind === "history")
            ? "Earlier conversation attached"
            : "Research context updated",
        )}
      </summary>
      {open && (
        <div>
          {notes.map((note, i) => (
            <pre key={i}>{note.text}</pre>
          ))}
        </div>
      )}
    </details>
  );
}
