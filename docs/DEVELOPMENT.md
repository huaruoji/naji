# Development Notes

## Build & Test

```bash
npm run typecheck    # TypeScript type checking (0 errors)
npm test            # 48 unit tests (vitest)
npm run test-llm    # Test LLM API connectivity
npm start -- build  # Compile TypeScript to dist/
```

All tests are in `src/__tests__/`:
- `conversation.test.ts` — ConversationManager (10 tests)
- `llm.test.ts` — OpenAI adapter + LLM module (18 tests)
- `workspace.test.ts` — Workspace file system (12 tests)
- `toolExecutor.test.ts` — Tool executor phases and decision handling (3 tests)
- `agent-policy.test.ts` — Reply policy classification and enforcement (5 tests)

## Code Map

```
src/
├── index.ts              # CLI entry (commander: start/init/config/test-llm/mock)
├── types.ts              # All type definitions
├── config.ts             # Config load/save from env + config.json
├── env.ts                # .env file loader (zero dependencies)
├── workspace.ts          # File system operations (replaces Tauri)
├── conversation.ts       # Append-only conversation manager
├── agent.ts              # SocialAgent class (~900 lines core)
├── llm/
│   ├── index.ts          # LLM API call wrapper (fetch)
│   └── openaiAdapter.ts  # OpenAI-compatible message/tool formatting
└── mcp/
    ├── client.ts         # MCP stdio client (JSON-RPC)
    └── toolExecutor.ts   # ReAct tool loop
```

## Change History

### 2026-05-14 — Reply policy, two-phase executor, and stability fixes

- **`decide()` → `reply()` / `silent()`**: Split single decide tool into two separate tools. LLM calls `reply(content)` to speak directly, `silent()` to stay quiet.
- **Reply policy**: `must_reply` / `may_silent` classification with code enforcement. Private chat and @-mentions cannot be silenced.
- **Two-phase executor**: Tool loop split into `gather` (read/edit) and `decide` (reply/silent) phases. Prevents "pre-commit silent before reading results".
- **Self-message filtering**: Bot's own replies no longer enter the message buffer (they're already in conversation as assistant messages).
- **Eval scaffolding as transient context**: Time/target headers and @-mention reminders no longer persist in conversation history.
- **Failed decision detection**: `stopAfterTool` checks `result.startsWith('[OK]')`. Failed `silent()/reply()` don't end the eval.
- **Single-round `social_read` cache**: Same path not re-read within the same eval.
- **Observability**: Buffer preview, reply policy reason, and reply-to mapping now printed in eval logs.
- **Health check**: No longer runs `docker restart napcat`; only logs warnings.
- **Mock MCP**: Added `check_status`, private message fixtures, and correct `batch_get_recent_context` response format.
- **48 unit tests** (up from 40): Added `agent-policy.test.ts` (5 tests) and `toolExecutor.test.ts` (3 tests).
- **Dead code removed**: `guessTargetType()`, `bufferHasContent`, `getApiUrl()`, `parseResponse` import.

### 2026-05-13 — Initial implementation

- **Session-stable security tokens**
- **`decide()` force decision tool**
- **Debounced evaluation**
- **Per-target independent conversations**
- **Initial history hydrate**: Cold-start imports recent messages into conversation with correct role semantics (user vs assistant). Prevent backlog "reply-all" on restart.
- **Streamable HTTP transport**: Amadeus MCP can run as a standalone HTTP server. Agent connects via HTTP instead of spawning a subprocess.
- **MCP startup health check**: Calls `check_status` on connect and logs NapCat/QQ status.
- **Serialized per-target evaluation**: Same target cannot have concurrent evaluations, preventing race conditions and duplicate replies.
- **Recent raw messages**: System-layer raw message cache per target, injected on context reset.
- **Document responsibility rules**: Each social file has a defined scope. Prompt constrains LLM to write to the correct file.
- **decide reply recorded in conversation**: Successful `decide("reply")` is written back to conversation as assistant message, so LLM knows it already replied.
- **Direct OneBot API fallback**
- **Automatic nickname detection**: QQ ID → profile lookup → auto-update on nickname change.
- **Auto-skip self-messages**: Bot's own replies cycled back via WebSocket are detected and skipped.
- **LLM retry**: Exponential backoff (1s/3s/10s) on API failures.
- **`reasoning_content` preservation**: DeepSeek reasoning mode compatibility.
- **Image retry optimization**: Failed image requests retry with 0s delay instead of 5s/25s/125s.

### Known Issues

1. **Amadeus WebSocket reliability**: WebSocket connection to NapCat sometimes disconnects after MCP server initialization. Fallback to OneBot HTTP is in place but `get_friend_msg_history` is not supported by NapCat.
2. **Private message polling**: Friend messages can only be received via WebSocket (NapCat doesn't support `get_friend_msg_history`). If WebSocket drops, private messages are missed until reconnection.
3. **Single-threaded eval**: All targets share the same event loop. A slow LLM call for one target delays others.
4. **Mock lacks streaming messages**: Mock MCP is useful for protocol testing but doesn't simulate incremental message arrival. A scripted message feed would enable stronger end-to-end testing.
5. **agent.md optimization**: The personality file is loaded once at startup. Hot-reload would be useful for iterative prompt engineering.
6. **Reply semantic verification**: The system enforces that a reply must happen in `must_reply` scenarios, but does not verify that the reply content actually addresses the current message (e.g., "讲个笑话" should not get "你还在吗"). This remains an LLM-level challenge.

## Design Rationale

### Why no Intent/Reply/Observer separation?

PetGPT's three-layer architecture exists because:
1. Different models can be used for different tasks (cheap model for Observer, smart model for Reply)
2. File-based handoff allows async processing (Observer runs independently)
3. Each layer has a different tool set

For agent-cli, the trade-off favors simplicity:
- One model handles everything
- `decide` tool replaces the entire handoff mechanism
- Each target has its own independent eval loop
- Result: ~580 lines instead of PetGPT's ~4000 lines for the social agent

### Why debounce instead of immediate eval?

The natural cadence of group chat is bursty: someone sends 3-5 messages in quick succession, then waits for a reply. Immediate eval after each message would:
1. Waste tokens (3 evals instead of 1)
2. Produce awkward replies (responding to message 1 without seeing messages 2-5)
3. Look unnatural ("bot keeps typing")

The 3s debounce captures most bursts with minimal latency.

### Append-only vs Stateless

PetGPT is **stateless**: every eval rebuilds the full context from files. This is robust (never gets confused by long history) but expensive (pays for full context every time).

agent-cli is **stateful-with-reset**: accumulates conversation until a threshold, then resets. This is efficient (caches well) but requires careful reset logic to avoid context overflow.

The 85% threshold is conservative. With DeepSeek V4 Flash's 1M context, a 200K threshold means ~170K tokens before reset — enough for thousands of messages.
