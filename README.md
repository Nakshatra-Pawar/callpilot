# CallPilot - voice-first sales copilot

CallPilot is a hands-free call workspace for sales reps. It keeps customer
context visible before and during a call, listens through a real-time voice
agent, turns spoken requests into structured notes and follow-up tasks, and
captures a post-call summary the rep can revisit later.

Voice is the interface. The UI stays quiet so reps can keep their attention on
the customer while CallPilot handles the small operational work that usually
gets lost between the call and the CRM.

> **Live sandbox:** [salescall-realtime-agent.vercel.app](https://salescall-realtime-agent.vercel.app)
> **Voice:** OpenAI Realtime API (`gpt-realtime`, `marin` voice), over WebRTC.

---

## Why CallPilot exists

Sales calls create a constant split-attention problem. The rep needs to listen,
respond, inspect account context, remember objections, capture notes, set next
steps, and later reconstruct what happened. Most CRM workflows ask them to do
that after the call, when details are already fading.

CallPilot moves those tasks into the live call:

- Pre-call context is visible before the first word.
- Spoken instructions become structured notes and follow-ups immediately.
- The transcript and tool actions stay connected, so the rep can spot and fix
  name or account mismatches.
- Post-call history turns each call into a reusable record instead of a memory
  exercise.

[Try the workflow](#try-the-workflow) · [How it works](#how-it-works) ·
[Architecture](#architecture) · [Sandbox boundaries](#sandbox-boundaries) ·
[Run locally](#run-locally)

---

## Try the workflow

1. Open the live sandbox in Chrome or Safari.
2. Enter your name, accept the mic/data notice, and click **Start talking**.
3. Try one of:
   - _"Save a note that Acme is interested in annual prepay at a 12% discount."_
   - _"Remind me to email Acme's CFO on Friday about the pricing doc."_
   - _"What was their last objection?"_
4. Watch the captured panels update as CallPilot calls tools, writes notes,
   creates follow-ups, and keeps the transcript visible.

The current app runs against seeded customer data and browser-local stores, so
it is safe to explore without connecting a real CRM.

---

## What it does

| Capability | How it works |
|---|---|
| **Personal call setup** | First-visit onboarding captures the rep's name. It is persisted to `localStorage`, threaded through the agent prompt, shown in the profile chip, and stamped on captured notes/tasks. |
| **Pre-call customer dossier** | A concise account brief, deal stage, contact, champion, recent activity, and objections stay visible beside the voice orb. Data comes from the seeded CRM fixture in `app/lib/data/customers.ts`. |
| **Customer Q&A by voice** | Free-form voice questions route through the current customer context. Deeper drill-downs can call `get_customer_context` for MEDDIC, objections, activity, or contact details. |
| **Structured notes** | `save_note`, `update_note`, and `delete_note` write to the in-browser note store and render in the **Notes** panel with lifecycle badges. |
| **Follow-up tasks** | `create_follow_up_task`, `update_follow_up_task`, and `cancel_follow_up_task` write to the task store and render in the **Tasks** panel, including cancelled state. |
| **Duplicate protection** | Notes and tasks are checked for near-duplicates before creation. If a likely duplicate exists, the agent asks before updating, keeping both, or doing nothing. |
| **Account vs. person safety** | Update tools validate account re-attribution against known CRM accounts. Person-name corrections are routed into the note/task body instead of corrupting the customer field. |
| **Pause and resume** | Icon-only call controls mute the mic through `session.mute()` while preserving the session state. |
| **Editable transcript** | User transcript lines can be edited locally with an "edited" badge and undo. Tool arguments remain visible as the model captured them. |
| **Transcript/action divergence** | If a tool's `customer` argument differs from the triggering transcript line, an amber `-> <name>` chip surfaces the mismatch for correction. |
| **Action ledger** | Tool calls render as collapsible action cards with arguments, result, status, and elapsed time. |
| **Post-call history** | Disconnecting requests a MEDDIC-style summary from `/api/summarize`; the call log stores prior summaries in `localStorage` for later review. |

All seven tool `execute` handlers currently run client-side and write to
browser-local stores. Moving a tool to production persistence is intentionally
straightforward: keep the Zod schema, replace the browser `execute` body with a
server route such as `/api/tools/save-note`, and back it with auth, CRM data,
database writes, and audit logging.

---

## How it works

CallPilot has three main surfaces:

1. **Call stage:** voice orb, transcript, call controls, and a customer brief
   that remains available while the rep is speaking.
2. **Captured ledger:** tasks, notes, and agent actions captured during the
   current call.
3. **Call history:** post-call summaries and prior call records stored on the
   device.

The voice agent is optimized for speed. When the rep asks for a tool-backed
action, the system prompt tells the agent to call the tool first and confirm
briefly after the result lands. The UI is the source of detail; the voice is for
confirmation and quick clarification.

---

## Architecture

```text
+-----------------+      1. POST /api/session       +-------------------+
|     Browser     | --------------------------------> |   Next.js API     |
|   (page.tsx)    |                                  |  /api/session     |
|                 | <----- ek_... ephemeral token --- |                   |
+--------+--------+                                  +---------+---------+
         |                                                     |
         | 2. WebRTC handshake + audio                         | server-only:
         |    (via @openai/agents-realtime)                    | OPENAI_API_KEY
         v                                                     v
+-----------------------------------------------------------------------+
|                   OpenAI Realtime API                                 |
|   model: gpt-realtime   ·   voice: marin   ·   transport: WebRTC      |
|                                                                       |
|   tool calls ---> 7 tools total:                                      |
|                    lookup: get_customer_context                       |
|                    notes:  save / update / delete                     |
|                    tasks:  create / update / cancel                   |
|                  (executed in the browser against local stores;       |
|                   result sent back to the model)                      |
+-----------------------------------------------------------------------+
```

**Three moving parts:**

1. `app/api/session/route.ts` exchanges the long-lived `OPENAI_API_KEY` for a
   short-lived `ek_...` ephemeral token. That is the only thing the server
   handles for live audio.
2. `app/page.tsx` fetches the ephemeral token, starts a `RealtimeAgent` and
   `RealtimeSession`, attaches mic/audio playback, and subscribes to
   `agent_tool_start`, `agent_tool_end`, and `history_updated`.
3. `app/lib/tools/*.ts` defines each `@openai/agents-realtime` tool with a Zod
   schema and an `execute` handler.

Audio bytes do not pass through the Next.js server. The browser connects to the
Realtime API over WebRTC after receiving the ephemeral token.

---

## Design decisions

### WebRTC over WebSocket

CallPilot uses WebRTC through `@openai/agents-realtime`, not raw WebSocket frames.

Why it fits this product:

- **Lower perceived latency.** Browser-native RTP + Opus keeps the voice loop
  feeling responsive during a live customer conversation.
- **Browser-native audio stack.** The SDK wires `getUserMedia` to a peer
  connection and audio playback without manual PCM encoding or resampling.
- **Packet-loss tolerance.** RTP/DTLS handles jitter better for reps on
  imperfect connections.
- **Server simplicity.** Audio is exchanged directly between the browser and
  OpenAI; the app server only mints ephemeral tokens.

Trade-offs:

- WebSocket frames are easier to inspect directly. CallPilot mitigates this with
  client-side logging around tool lifecycle events.
- WebSocket is useful for text-only realtime flows. CallPilot is intentionally a
  voice-first call workspace.

### Ephemeral tokens

The root `OPENAI_API_KEY` lives in `.env.local` for development and the deploy
provider's encrypted environment for production. `/api/session` exchanges it
for a short-lived `ek_...` token that is scoped to a single realtime session.

That pattern keeps the browser from ever seeing the root API key while still
allowing direct WebRTC audio.

### Client-side tools in the sandbox

The current tool handlers run in the browser and write to module-level stores.
That keeps the sandbox fast to run and easy to reason about:

- zero network hop for local note/task writes,
- clear tool-call visibility in the UI,
- no database, Redis, or CRM credentials required.

In production, each tool should become a thin server mutation with auth,
authorization, persistence, CRM entity resolution, and audit logs. The tool
names and schemas can stay stable.

### shadcn + Vercel AI Elements

- **shadcn/Radix Nova preset** provides the dark shell, Lucide icons, Geist
  fonts, and reusable primitives.
- **Vercel AI Elements `<Tool>` primitive** renders action cards with status,
  collapsible args/results, and highlighted JSON.

---

## Trust and correction

### The "Atmas / Acme" problem

Live voice systems can disagree with themselves. The transcript is optimized
for phoneme-to-text output; the reasoning model also sees conversation context
and may infer a CRM account. Those two signals can diverge.

Example patterns observed while testing the workflow:

| Transcript text | Tool argument |
|---|---|
| "Atmas CFO" | `customer: "Acme CFO"` |
| "Akne" / "Agnes" | `customer: "Acme"` |
| "Globelex" / "Gloplex" / "Globepex" | `customer: "Gloplex"` |
| "TechNicorp" | `customer: "TechNicorp"` |

CallPilot treats that disagreement as a product problem, not just a model issue.
The system prompt tells the agent to trust the rep's literal words by default,
because similar-sounding account names are common in sales. The UI also shows a
small divergence chip when a tool's customer argument does not match the
triggering transcript line.

That chip is neutral:

- If the transcript is wrong, the rep can edit the transcript line.
- If the tool argument is wrong, the rep can correct the account by voice and
  the agent updates the note or task with `new_customer`.

In a production CRM integration, this becomes a customer-disambiguation flow
against real account records.

---

## Sandbox boundaries

CallPilot is currently a working sandbox of the intended solution. The real-time
voice flow, tool schemas, transcript editing, call summaries, and local history
are functional. The data plane is intentionally lightweight:

1. **Seeded CRM context.** Customer data lives in `app/lib/data/customers.ts`.
   Production should read account, contact, opportunity, activity, and support
   data from a CRM or customer data platform.
2. **Browser-local stores.** Notes, tasks, rep identity, and call history use
   module stores plus `localStorage`. Production should persist these to a
   database with user/workspace scoping.
3. **No real auth layer.** The onboarding modal stands in for identity.
   Production should use an auth provider and enforce per-account access.
4. **No server-side audit trail yet.** Tool calls are visible in the UI, but
   production should write immutable audit events for every create/update/delete.
5. **Entity resolution is local.** The seeded CRM has a simple fuzzy lookup.
   Production should resolve accounts and contacts before mutations land.
6. **List/query tools are not wired yet.** The agent can answer from recent
   conversation context, but production should add `list_notes` and
   `list_follow_up_tasks` so stored records are the source of truth.
7. **Elapsed tool time is near-zero in local mode.** Timings will become
   meaningful once mutations cross a server/database boundary.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2.4 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/postcss`) |
| Component kit | shadcn (Radix Nova preset) |
| AI UI kit | [Vercel AI Elements](https://ai-sdk.dev/elements) (`<Tool>`, `<CodeBlock>`) |
| Realtime SDK | `@openai/agents-realtime` - WebRTC transport |
| AI backend | OpenAI Realtime API, `gpt-realtime` model, `marin` voice |
| Schema | Zod (tool params) |
| Icons / fonts | Lucide · Geist sans + mono |
| Deploy | Vercel (Node runtime, default preset) |

Node 20.19.0 · npm 10.8.2 · React 19 · no `src/` directory.

---

## Run locally

```bash
# 1. Install dependencies
npm install

# 2. Env - needs an OpenAI key with Realtime access
cp .env.example .env.local
# then edit .env.local and paste your sk-proj-... key

# 3. Dev server
npm run dev

# 4. Open http://localhost:3000 in Chrome and click "Start talking"
```

No database, Redis, migrations, or CRM credentials are required for the sandbox.

---

## Project layout

```text
app/
├── api/
│   ├── session/route.ts           # mints ek_... ephemeral token
│   └── summarize/route.ts         # POST transcript -> summary JSON
├── hooks/                         # side-effect hooks
│   ├── use-agent-amplitude.ts     # tracks agent audio amplitude
│   ├── use-consent.ts             # first-visit consent gate
│   ├── use-mic-amplitude.ts       # 60Hz FFT -> orb amplitude
│   └── use-session-cap.ts         # 10-min wall clock + auto-disconnect
├── layout.tsx                     # dark mode, Geist fonts, metadata
├── page.tsx                       # composition root (session + JSX)
└── lib/
    ├── agent.ts                   # prompt composition + UX helpers
    ├── data/customers.ts          # seeded CRM accounts
    ├── helpers.ts                 # pure helpers
    ├── types.ts                   # page-level shared types
    ├── store/
    │   ├── callHistoryStore.ts    # localStorage-backed past calls
    │   ├── customerStore.ts       # selected-customer state
    │   ├── noteStore.ts           # notes + duplicate detection
    │   ├── repStore.ts            # signed-in rep
    │   └── taskStore.ts           # tasks + duplicate detection
    └── tools/
        ├── getCustomerContext.ts
        ├── saveNote.ts
        ├── updateNote.ts
        ├── deleteNote.ts
        ├── createFollowUpTask.ts
        ├── updateFollowUpTask.ts
        └── cancelFollowUpTask.ts
components/
├── ai-elements/                   # Vercel AI Elements
├── callpilot/                       # feature UI
├── ui/                            # shadcn primitives
└── voice-orb.tsx                  # canvas waveform visualizer
lib/utils.ts                       # shadcn cn() helper
```

---

## Credits

- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [openai-realtime-agents](https://github.com/openai/openai-realtime-agents)
- [shadcn/ui](https://ui.shadcn.com/)
- [Vercel AI Elements](https://ai-sdk.dev/elements)
- [Next.js](https://nextjs.org)
- [Tailwind CSS](https://tailwindcss.com)
