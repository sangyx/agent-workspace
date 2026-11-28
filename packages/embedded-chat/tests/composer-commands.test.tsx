import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptComposer } from "../src";
import { matchCommands } from "../src/PromptComposer";

const commands = [
  { name: "btw", description: "Ask a side question" },
  { name: "goal", hint: "goal", description: "Run until the goal is met" },
  { name: "compact", description: "Summarize the conversation" },
  { name: "review", description: "Review the goal and current diff" },
];
const Icon = () => <svg />;
const render = (value: string) =>
  renderToStaticMarkup(
    <PromptComposer
      tx={(s) => s}
      Icon={Icon}
      voicePhase="idle"
      onDictate={() => {}}
      value={value}
      onChange={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      busy={false}
      placeholder=""
      label="Message"
      controls={null}
      commands={commands}
    />,
  );

describe("composer slash menu", () => {
  it("lists prefix matches first, then name or description matches", () => {
    expect(matchCommands(commands, "/").map((c) => c.name)).toEqual([
      "btw",
      "goal",
      "compact",
      "review",
    ]);
    expect(matchCommands(commands, "/go").map((c) => c.name)).toEqual([
      "goal",
      "review",
    ]);
    expect(matchCommands(commands, "/zzz")).toEqual([]);
  });

  it("closes once arguments start or the text is not a command", () => {
    expect(matchCommands(commands, "/goal finish")).toEqual([]);
    expect(matchCommands(commands, "hello /go")).toEqual([]);
    expect(matchCommands(commands, "")).toEqual([]);
  });

  it("renders the menu only while a command name is being typed", () => {
    const open = render("/co");
    expect(open).toContain('role="listbox"');
    expect(open).toContain("/compact");
    expect(open).toContain('aria-selected="true"');
    expect(render("plain text")).not.toContain('role="listbox"');
  });
});
