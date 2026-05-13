# naji（娜稽）

**Append-only 社交 AI Agent CLI** — 基于 MCP 协议的轻量 QQ 群聊 AI 助手。

架构继承自 [PetGPT](https://github.com/JulesLiu390/PetGPT)，核心设计围绕 prompt 前缀缓存优化和极简 token 消耗展开。

## 特性

- **Append-only 对话** — 系统 prompt 永远不变，只追加新消息。最大化 LLM prompt prefix 缓存命中率（实测 65%-96%）。
- **decide 强制决策** — 每次 eval 必须以 `decide("reply")` 或 `decide("silent")` 结束。不再出现"忘记调 send_message"。
- **防抖评估** — 3 秒窗口合并多条消息后再评估，避免机器人喋喋不休。
- **每 target 独立上下文** — 每个群聊和私聊有各自的对话历史，互不干扰。
- **安全令牌** — 会话级随机分隔符包裹每条消息，防止 prompt 注入。
- **纯 CLI** — 无需 Tauri、GUI、桌面应用，任何有 Node.js 的系统都能跑。
- **无数据库** — LLM 通过 `social_write`/`social_edit` 把重要信息写为 markdown 文件，零 schema 管理。

## 架构

```
NapCatQQ (Docker)  ←  QQ 协议客户端，OneBot v11
    ↕ WebSocket + HTTP
Amadeus-QQ-MCP (uv)  ←  MCP 桥接，消息缓冲
    ↕ Streamable HTTP 或 stdio
naji (tsx)  ←  社交 Agent 引擎
    ↕ HTTPS
LLM API (OpenCode Go / DeepSeek / OpenAI)
```

## 前置依赖

- Docker（跑 NapCatQQ）
- Python 3.11+ + [uv](https://docs.astral.sh/uv/)（跑 Amadeus-QQ-MCP）
- Node.js 18+

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/huaruoji/naji.git
cd naji
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 LLM API key
```

### 3. 初始化社交目录

```bash
npx tsx src/index.ts init
```

这会生成 `social/` 目录和示例配置文件。

### 4. 启动 NapCatQQ

Amadeus-QQ-MCP 提供了 NapCatQQ 的 Docker 配置：

```bash
git clone https://github.com/JulesLiu390/Amadeus-QQ-MCP.git ~/projects/Amadeus-QQ-MCP
cd ~/projects/Amadeus-QQ-MCP
docker compose up -d napcat
docker logs napcat  # 扫码登录
```

### 5. 启动 Amadeus MCP Server

```bash
cd ~/projects/Amadeus-QQ-MCP
uv run qq-agent-mcp --qq 你的QQ号 --transport streamable-http --host 127.0.0.1 --port 8099 --groups 群号 --friends 好友QQ号
```

### 6. 启动 Agent

```bash
cd ~/projects/naji
npx tsx src/index.ts start
```

## 命令

| 命令 | 说明 |
|------|------|
| `npm start -- init` | 初始化 `social/` 目录 |
| `npm start -- start` | 启动 naji（连续模式） |
| `npm start -- start --mock --once` | 测试模式（单次评估后退出） |
| `npm run test-llm` | 测试 LLM API 连通性 |
| `npm run test` | 运行单元测试 |
| `npm run typecheck` | TypeScript 类型检查 |

## 设计原则

### Append-Only 对话
系统 prompt 在 Agent 整个生命周期内只生成一次，之后只追加新消息。这使得 LLM provider 的 prompt prefix 缓存命中率达到 65%-96%（实测首轮全价，后续仅付增量 token 费用）。

### decide 强制决策
每轮评估结束时 LLM 必须调用 `decide()` 做出明确决策，系统自动执行回复发送。替代了 PetGPT 的 Intent/Reply/Observer 三层分离设计，大幅简化架构。

### 防抖评估
群聊消息天然有突发性（连续 3-5 条后等待回复）。3 秒防抖窗口合并一次评估，避免：
- 多条消息引发多次 LLM 调用
- 模型在没看到后续消息时就仓促回复
- token 浪费在冗余评估上

### 文档职责分离
Agent 的知识由多个 markdown 文件组成，各文件职责明确，LLM 自主维护：
- `owner.md` — 主人偏好和指示
- `people/*.md` — 人物档案
- `group/RULE_*.md` — 群组文化
- `notes.md` — 通用知识
- `CONTACTS.md` — 联系人索引

### 安全令牌
会话级随机分隔符包裹每条消息，防止 prompt 注入。只有真正的 owner（QQ 匹配）才能在身份区域获得安全令牌。

## 项目依赖

| 项目 | 角色 | 来源 |
|------|------|------|
| [PetGPT](https://github.com/JulesLiu390/PetGPT) | 架构参考、LLM 适配器、工具执行循环 | 上游启发 |
| [Amadeus-QQ-MCP](https://github.com/JulesLiu390/Amadeus-QQ-MCP) | QQ 消息 MCP 桥接 | Fork |
| [OpenCode Go](https://opencode.ai/docs/zh-cn/go/) | 低成本 LLM API | 可选服务商 |

## License

MIT
