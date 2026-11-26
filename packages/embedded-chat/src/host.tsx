import { createContext, useContext, type ReactNode } from "react";
import type { ChatHost } from "./contracts";
const Context = createContext<ChatHost | null>(null);
export function ChatHostProvider({
  host,
  children,
}: {
  host: ChatHost;
  children: ReactNode;
}) {
  return <Context.Provider value={host}>{children}</Context.Provider>;
}
export function useChatHost(): ChatHost {
  const host = useContext(Context);
  if (!host) throw new Error("Embedded Chat needs a ChatHostProvider.");
  return host;
}
export function Icon(props: { name: string; size?: number }) {
  const Component = useChatHost().Icon;
  return <Component {...props} />;
}
