# Shared Chat behavior

The native Claude and ChatGPT interfaces share the full Workspace engine, IPC,
settings, providers, import dialog and transcript state. Host integrations do not
need to reproduce these features in a separate chat implementation.

Existing reusable behavior includes Antigravity model/reasoning selection,
permission modes (`auto`, `edits`, `ask`), local/OpenAI speech recognition, side
questions, local/SSH file previews, persistent project expansion and context
presentation that folds injected memory/history without changing provider data.

Antigravity also supports SSH hosts. Remote discovery, saved history, model and
reasoning catalogs, and continuation use the `agy` installed and signed in on
that machine. Its login-shell PATH (including `~/.local/bin`) is used; local
Antigravity credentials or history are not substituted. Active remote ACP
sessions use the existing detached SSH transport, while metadata queries use
short-lived connections. Native sandbox and approval handling stay enabled.
Antigravity appears in the remote import filter and host readiness badges;
interactive installation/sign-in remains available through that host's terminal.

## Imports

- Pick an existing destination project, or keep the original folder association.
- The original working directory and machine are preserved. Cross-machine
  destinations are rejected, including direct IPC calls.
- Re-importing opens the existing task. Its project, native session, permissions,
  archived state and raw transcript stay unchanged. Concurrent imports do not
  create duplicate tasks or local project folders.
- Session identity includes provider and SSH machine, not just the provider's ID.
- Automatic folder matching picks the closest enclosing project.
- Search accepts multiple terms across title, folder, provider, date and machine,
  normalizing case and full-width characters. Long injected titles are formatted
  once per scan, rather than again for every keystroke.

## Long conversations

Both interfaces use the same transcript cache. A batch copies each changed
conversation once and retains unchanged row identities. A full-history reset is
honored in both interfaces; late loads cannot replace a newer reset, and streamed
updates received during a load are retained. An unchanged event does not trigger
a transcript state update. Raw stored and provider histories are untouched.

Regression coverage lives in `import-preservation.test.ts`,
`transcript-cache.test.ts`, `host-presentation.test.ts` and the embedded package's
import/presentation tests. These are deterministic fixtures, not real-provider
performance benchmarks.

Research-specific context generation and host project catalog reconciliation
remain the responsibility of the embedding app. No host research data, credentials
or user transcripts are included in this repository.

## Upstream 0.15.5 integration

Merged upstream `e6681b5` while retaining host categories, import assignments,
lossless context presentation, shared transcript caching, SSH Antigravity and
model/reasoning controls. Chrome and Artifacts support use upstream's provider
path and permission workflow. Codex yes/no MCP requests appear as approvals;
forms requiring fields remain unsupported, as upstream reports.

Both interfaces include the full-width sub-agent scrolling and attachment remove
button fixes. Their shared Settings page uses the upstream on/off switches; the
customized interface includes the matching switch styles.
