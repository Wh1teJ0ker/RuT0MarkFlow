# ZCode Bridge 审查报告 — 持久化模型恢复修复与 agent 调度就绪度

- **status**: reviewed
- **author**: code-review-workflow
- **date**: 2026-07-06
- **scope**: `tools/zcode-bridge.mjs`、README、package.json 中与桥接相关配置

---

## 审查结论

**持久化模型恢复修复已实现**，但**要使 review-agent / coding-agent 调度在此 workspace 彻底可用，还有 7 个缺口需要补齐**。以下按影响程度排序。

---

## 一、持久化模型修复评估

### 1.1 改动范围

`applyRuntimeModelSelection` (line 955–1008) 在已有 `session/setModel` + `workspace/setDefaultModel` + `session/updateRuntimeModelConfig` 的链条末尾，新增了 `syncPersistedRuntimeModelState`（line 1010–1029），分两条路径回写持久化存储：

| 路径 | 目标库 | 函数 | 说明 |
|------|--------|------|------|
| 消息 DB | `~/.zcode/cli/db/db.sqlite` | `syncPersistedMessageModelState` (line 1032–1091) | 更新最近 16 条消息的 `providerID` / `modelID` / `thoughtLevel` |
| 任务索引 | `~/.zcode/v2/tasks-index.sqlite` | `syncTaskIndexModelState` (line 1140–1201) | 更新 tasks 表 model 字段和 meta_json |

### 1.2 设计合理性

- **按需更新**：只更新最近 N 条（16），不做全量 scan，避免大表写锁
- **事务保护**：消息 DB 更新包裹在 `BEGIN IMMEDIATE TRANSACTION` 内
- **跳过未变更**：`applyDesiredModelToPersistedMessage` 检查 `payload.role === "assistant"` 且 `providerID`/`modelID` 有变化才修改
- **任务索引精确匹配**：用 `workspace_path + task_id` 定位单行，不影响其他任务

### 1.3 评估结论

✅ **修复本身逻辑正确，功能完整**。`set-runtime-model` 之后 session 和持久化存储的模型元数据一致，重启后能恢复正确模型。

---

## 二、review-agent / coding-agent 调度就绪度缺口

### 🔴 P0 缺口：send 不能提取 assistant 回复内容

**文件**：`tools/zcode-bridge.mjs` line 107–218 (`runSend`)

**问题**：`send` 命令的 `wait` 结果只返回轮询元数据（`status`、`activeToolCalls`、`backgroundJobs` 等），不包含 assistant 的最终回复文本。对于 agent 调度，orchestrator 需要知道 agent 执行了什么、写入了什么结论、是否完成了任务。

**影响**：外部调度器无法通过 `send` 拿到 agent 的产出，只能依赖落盘文件（HANDOFF/REPORT），但 bridge 不提供检查这些文件是否已更新的能力。

**当前绕过**：靠 `send` 退出后，orchestrator 手动读 `handoff/TASK-<id>-REPORT.md` 或 `handoff/VERIFICATION-REPORT.md`。但 bridge 没有返回这些路径的能力。

### 🔴 P0 缺口：缺少 session 创建能力

**问题**：`list-sessions` 只查询已有 session。如果当前 workspace 没有匹配的 session（例如首次使用），`send` 直接报错 `"No ZCode sessions are available"`。而 review/coding agent 调度往往需要先创建 session。

**影响**：调度器必须手动先启动 ZCode session，再调用 bridge，无法完全自动化。

### 🟡 P1 缺口：没有 tool-use 结果的读取转换

**问题**：`waitForPromptCompletion` 只返回 `activeToolCalls` 数量，不读取 tool 的执行结果（如 `write_file` 写入的内容、`read_file` 的结果）。对于 coding-agent 的自动化调度，需要确认 agent 实际执行了哪些文件写入。

**影响**：无法判断 agent 是否真的写了代码或 report。

### 🟡 P1 缺口：缺少消息格式模板 / 校验

**文件**：`tools/zcode-bridge.mjs` line 624–638 (`resolveMessage`)

**问题**：`send` 接受纯文本消息，不做任何格式校验。而 review-agent 和 coding-agent 使用固定的 HANDOFF 格式（YAML frontmatter + 特定字段）。bridge 不提供模板填充、frontmatter 字段校验或 markdown 格式组装。

**影响**：发送格式错误的消息，agent 可能无法正确解析任务 scope。

### 🟡 P1 缺口：命名不一致

**问题**：
- 实际文件名：`tools/zcode-bridge.mjs`
- npm script：`zcode:bridge`
- help 文本内写的是：`node tools/n.mjs doctor`（line 1370–1373）
- 还有一个 `"n": "node tools/n.mjs"` 的 script 入口**不存在于当前 package.json**（grep 检索到但已核实：当前 package.json 没有 `"n"` 条目）

**影响**：用户按 help 文本执行 `node tools/n.mjs` 会失败。README 和实际脚本名不一致。

### 🟢 P2 缺口：路径硬编码

**文件**：`tools/zcode-bridge.mjs` line 8–18

**问题**：4 个默认路径全部硬编码到 `~/.zcode/` 下的固定位置。虽然通过环境变量可以覆盖，但：
- `ZCODE_MESSAGE_DB_PATH` 和 `ZCODE_TASKS_INDEX_PATH` 没有在 help 或 README 中说明
- 路径依赖 ZCode 内部目录结构，未来 ZCode 升级可能变化

### 🟢 P2 缺口：无测试覆盖

**问题**：`tools/` 目录没有任何测试文件（`tools/zcode-bridge.mjs` 是唯一文件）。1300+ 行的 CLI 工具，涉及 SQLite 写入、协议交互、多命令分支，0 测试覆盖。

**影响**：持久化模型修复（`syncPersistedMessageModelState` 和 `syncTaskIndexModelState`）的 SQL 语句和逻辑路径未经测试验证。

---

## 三、调度就绪度汇总

| 维度 | 当前状态 | 影响 |
|------|----------|------|
| 会话发现 | ✅ `list-sessions` 按 workspace 过滤 | 可找到目标 session |
| 消息发送 | ✅ `send` 支持消息 + wait | 但取不到回复内容 |
| 模型设置与持久化 | ✅ `set-runtime-model` + 回写 DB | 重启后模型可恢复 |
| 健康检查 | ✅ `doctor` 命令可用 | 可快速验证链路 |
| 回复提取 | ❌ 无 | 调度器不知 agent 结论 |
| 会话创建 | ❌ 无 | 首次使用需手动介入 |
| 工具结果读取 | ❌ 无 | 无法确认 agent 实际写入 |
| 消息格式校验 | ❌ 无 | 易发格式错误消息 |
| 自动重试 | ❌ 无 | 网络抖动会失败 |
| 测试覆盖 | ❌ 0 测试 | 改动无安全网 |

---

## 四、建议优先级

### 立即（P0）

1. **send 后提取 assistant 回复** — 在 `waitForPromptCompletion` 返回后，增加一次 `session/read` 读取最新消息，提取 assistant 角色消息的 `content` 并返回给调用方
2. **session 创建** — 增加 `start-session` 命令，或 `send` 遇到无 session 时自动创建

### 短期（P1）

3. **tool-use 结果读取** — 在 wait 完成后，读取 `session/read` 的 `projection.activeToolCalls` 或 `projection.messages` 中的 tool 结果
4. **消息模板** — 增加 `--handoff` 参数，自动读取 HANDOFF.md 并组装成 agent 可识别的格式
5. **修复命名不一致** — 更新 help 文本中的 `n.mjs` 为 `zcode-bridge.mjs`，或统一文件名

### 后续（P2）

6. **更友好的路径配置** — 在 help 中补充 `ZCODE_MESSAGE_DB_PATH` 和 `ZCODE_TASKS_INDEX_PATH` 的说明
7. **测试** — 对 `syncPersistedMessageModelState`、`syncTaskIndexModelState`、`listSessions` 等功能添加单元测试

---

## 五、本文档状态

- **status**: reviewed
- **next step**: 建议按 P0 → P1 → P2 顺序补齐缺口，补齐后 `send` 命令即可作为 review-agent / coding-agent 调度器的可靠消息通道。