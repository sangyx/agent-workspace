# Embedded Chat

A host-neutral, customized Chat surface for applications embedding Agent Workspace.
The native engine remains `app/src/main/workspace.ts`; this package adds reusable
conversation rendering, a composer, native requests, a task map, side questions,
file previews, normalized transport models, and an NDJSON engine entry.

The standalone Agent Workspace Electron entry is unchanged. This is an optional
embedding API, not a replacement for its main renderer.

## Boundary

`ChatHostProvider` receives typed ports from the embedding application. The host
supplies transport, project/settings adapters, navigation, translation, voice,
attachment/model controls, PDF rendering and shell widgets. No research schema,
host-specific filesystem path, API key or project content belongs in this package.
The native entry accepts the workspace directory and provider constructors at
runtime. It never reads another application's saved workspace implicitly.

```tsx
import { ChatPage, ChatHostProvider } from '@agent-workspace/embedded-chat';
import '@agent-workspace/embedded-chat/foundation.css';
import '@agent-workspace/embedded-chat/styles.css';
// Implement ChatHost in your app. Supply --ink, --surface, --bg, --line,
// --muted and --accent CSS variables using the application's own theme.
<ChatHostProvider host={host}><ChatPage pid={projectId} id={conversationId} /></ChatHostProvider>
```

The `api` port implements the `/chat` conversation API used by `ChatPage`; see its
call sites and `workspaceChat.ts` for payloads. This is an initial embedding API,
not a general-purpose compatibility promise for arbitrary transports. The ports
keep policy, credentials and research context with the embedding host.

`PromptComposer` is independently reusable with explicit translation, icon,
voice-state and dictation callbacks; it does not require a provider. Hooks passed
as ports must keep a stable implementation for the lifetime of a mounted surface.
The standalone app and host can use React 18 or 19; deduplicate React in the host
bundler to avoid separate hook runtimes.

## Validate and contribute

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run typecheck
npm test
```

Tests cover retained message identities, native approval/question separation,
history presentation, import titles/search, task maps, isolated host instances,
and file-link rendering. Changes to native providers/core also require the app's
own typecheck and unit suite. Do not put conversation transcripts, private prompts,
credentials, host settings or research fixtures in an upstream contribution.

The package retains the repository's AGPL-3.0-only license. See the root LICENSE.
