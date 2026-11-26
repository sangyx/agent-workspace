import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChatHostProvider,
  ChatPage,
  ChatMarkdown,
  ChatPreviewContext,
  ChatTaskMap,
  PromptComposer,
} from "../src";
import type { ChatHost } from "../src/contracts";
const Icon = () => <svg />;
function host(language: string): ChatHost {
  return {
    language,
    tx: (s) => language + ":" + s,
    api: vi.fn(async () => ({})) as ChatHost["api"],
    navigate: vi.fn(),
    copyText: vi.fn(),
    hideAssistant: vi.fn(),
    chatChanged: vi.fn(),
    newChatProject: vi.fn(),
    importChat: vi.fn(),
    renameChatProject: vi.fn(),
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    openContextMenu: vi.fn(),
    toggleSidebar: vi.fn(),
    useSidebarVisible: () => true,
    usePromptAI: () => ({
      options: {},
      ready: true,
      controls: { value: {}, onChange: vi.fn() },
    }),
    draftKey: (id, pid) => "test:" + (id || pid || "new"),
    transientKey: (kind, id) => kind + ":" + id,
    events: { archived: "test:archive", chatsUpdated: "test:changed" },
    Icon,
    Header: ({ children }) => <header>{children}</header>,
    AIControls: () => <div />,
    Composer: (props) => (
      <PromptComposer
        {...props}
        tx={(s) => s}
        Icon={Icon}
        voicePhase="idle"
        onDictate={() => {}}
      />
    ),
    DirectoryPicker: () => <div />,
    SidebarPaneControls: () => <div />,
    PDFPreview: () => <div />,
  };
}
it("renders the portable Chat surface through host ports without reading a workspace", () => {
  const storage = { getItem: () => null };
  vi.stubGlobal("localStorage", storage);
  const one = host("one");
  const render = (h: ChatHost) =>
    renderToStaticMarkup(
      <ChatHostProvider host={h}>
        <ChatPage />
      </ChatHostProvider>,
    );
  expect(render(one)).toContain("one:New chat");
  expect(render(host("two"))).toContain("two:New chat");
  expect(render(one)).not.toContain("two:");
  expect(one.api).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("keeps file links internal only when a host supplies a preview action", () => {
  const html = renderToStaticMarkup(
    <ChatPreviewContext.Provider value={() => {}}>
      <ChatMarkdown>
        {"[PDF](file:///tmp/report.pdf) [Website](https://example.org)"}
      </ChatMarkdown>
    </ChatPreviewContext.Provider>,
  );
  expect(html).toContain('href="file:///tmp/report.pdf"');
  expect(html).toContain('href="https://example.org" target="_blank"');
});
it("renders task outcomes using the host language and keeps native decisions visible", () => {
  const html = renderToStaticMarkup(
    <ChatHostProvider host={host("en")}>
      <ChatTaskMap
        current={0}
        onJump={() => {}}
        onOpen={() => {}}
        tasks={[
          {
            start: 0,
            title: "Evaluate",
            outcome: "Passed",
            turns: 1,
            files: [],
            commands: 0,
            decisions: [{ turn: 0, kind: "approval", label: "Run checks" }],
            attempts: [],
            subagents: [],
            branches: [],
          },
        ]}
      />
    </ChatHostProvider>,
  );
  expect(html).toContain("Evaluate");
  expect(html).toContain("Run checks");
  expect(html).toContain("Passed");
});
