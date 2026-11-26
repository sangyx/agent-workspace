import { useEffect } from "react";
export interface WorkspaceHostCommand {
  page?: "chat" | "settings" | "overview";
  taskId?: string;
  section?: string;
  action?: "new" | "import" | "usage" | "toggle-left" | "toggle-right";
  theme?: Record<string, string>;
  leftHidden?: boolean;
  rightHidden?: boolean;
}
declare global {
  interface Window {
    amwHost?: {
      onCommand: (cb: (command: WorkspaceHostCommand) => void) => () => void;
      notify: (event: {
        page: "chat" | "settings" | "overview";
        taskId?: string;
      }) => void;
    };
  }
}
/** A small chrome boundary. The native renderer and its IPC API remain the same. */
export function useWorkspaceEmbedding({
  focusId,
  settingsOpen,
  onCommand,
}: {
  focusId: string | null;
  settingsOpen: boolean;
  onCommand: (c: WorkspaceHostCommand) => void;
}) {
  useEffect(() => {
    return window.amwHost?.onCommand(onCommand);
  }, [onCommand]);
  useEffect(() => {
    window.amwHost?.notify({
      page: settingsOpen ? "settings" : focusId ? "chat" : "overview",
      taskId: focusId ?? undefined,
    });
  }, [focusId, settingsOpen]);
}
