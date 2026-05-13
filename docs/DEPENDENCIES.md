# Dependencies & References

## Runtime Dependencies

| Component | Role | How It Runs |
|-----------|------|-------------|
| **NapCatQQ** (`mlikiowa/napcat-docker`) | QQ protocol client. Receives/sends messages via OneBot v11 API. | Docker container |
| **Amadeus-QQ-MCP** | Python MCP server. Bridges NapCat's OneBot API to MCP protocol. Maintains message buffer. | Spawned by agent-cli via `uv run` |
| **agent-cli** | TypeScript social agent engine. | Direct Node.js (`tsx`) |

## Reference Projects

### [PetGPT](https://github.com/JulesLiu390/PetGPT)

The upstream inspiration for this project. PetGPT is a full-featured desktop application with Tauri (Rust) backend, React frontend, and a sophisticated social agent system.

**What we borrowed:**

| Component | File in PetGPT | Usage in agent-cli |
|-----------|---------------|-------------------|
| OpenAI adapter | `src/utils/llm/adapters/openaiCompatible.js` | `src/llm/openaiAdapter.ts` — message conversion, tool formatting, response parsing |
| Tool executor | `src/utils/mcp/toolExecutor.js` | `src/mcp/toolExecutor.ts` — ReAct tool loop, `callLLMWithTools` |
| Security tokens | `src/utils/socialAgent.js` (getSessionTokens) | `src/agent.ts` — session-stable delimiters |
| Social prompt builder | `src/utils/socialPromptBuilder.js` | _Concept only_ — simplified to single agent.md |
| Message format | `src/utils/socialAgent.js` (buildTurnsFromMessages) | `src/agent.ts` (processRawMessages) — security-wrapped messages |
| Prompt cache | `src/utils/promptCache.js` | _Concept only_ — explicit cache key strategy |
| `reasoning_content` fix | `src/utils/mcp/toolExecutor.js` + `src/utils/llm/adapters/openaiCompatible.js` | _Fixed in PetGPT first_, then ported here |

**What we changed:**

| Aspect | PetGPT | agent-cli |
|--------|--------|-----------|
| Decision flow | `get_situation` → `write_intent_plan` → Reply consumes | `decide("reply"/"silent")` |
| Layers | Intent + Observer + Reply + Fetcher (4 layers) | Single agent + Fetcher (2 layers) |
| System prompt | Rebuilt every eval from files | Append-only (stable prefix) |
| Message delivery | Three retries (5s/25s/125s) + image fallback | Immediate with `decide` |
| Context per target | Shared conversation | Independent per-target conversations |
| Persistence | SQLite database + workspace files | Workspace files only |

### [Amadeus-QQ-MCP](https://github.com/JulesLiu390/Amadeus-QQ-MCP)

The MCP server that bridges NapCatQQ's OneBot API to the MCP protocol. Provides tools for sending messages, fetching message history, and receiving real-time events via WebSocket.

**MCP tools provided:**
- `check_status` — QQ login status
- `get_group_list` / `get_friend_list` — list targets
- `get_recent_context` / `batch_get_recent_context` — fetch buffered messages
- `send_message` / `send_image` / `send_voice` — send content
- `compress_context` — manual buffer compression
- `screenshot_chat` — take screenshot

### [OpenCode Go](https://opencode.ai/docs/zh-cn/go/)

Low-cost LLM API subscription ($10/month). Provides access to open-source programming models including DeepSeek V4 Flash.

**API endpoint:** `https://opencode.ai/zen/go/v1`
**Models used:** `deepseek-v4-flash` (recommended for agent tasks)

**Alternative providers:**
- DeepSeek Official: `https://api.deepseek.com/v1` (may SSL timeout through proxies)
- OpenAI: `https://api.openai.com/v1`
- Any OpenAI-compatible API

## Key Design Decisions

### Why no database?

PetGPT uses SQLite for conversations, settings, and history. We use **zero databases**:
- Messages are ephemeral — only in memory + LLM context
- Important info persists as markdown files in `social/people/*.md` etc.
- The LLM itself decides what to remember via `social_write`/`social_edit`
- This eliminates schema management, migrations, and sync issues

### Why `decide` instead of separate Intent/Reply?

PetGPT's two-stage decision (Intent writes plan → Reply executes) requires:
- Two different LLM configs (potentially different models)
- File-based handoff (`reply_brief.md`)
- Complex state management

agent-cli's single `decide` tool is simpler:
- One LLM call, one decision
- System auto-sends on `decide("reply")`
- No handoff files needed
- Easier to debug (one trace per eval)

### Why append-only conversation?

The most impactful optimization for token cost:
- LLM prompt caches work on **prefix matching**
- A stable prefix → maximum cache hit rate
- Cache hit rate of 65-96% vs PetGPT's 55-60%
- At 96% cache, a 50K-token eval costs ~2K tokens
