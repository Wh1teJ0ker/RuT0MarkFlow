# RuT0MarkFlow

轻量级 Markdown 工作区浏览器与编辑器，基于 Tauri + Rust + React 构建。

## 项目状态

**MVP 第一阶段完成** — 工作区选择闭环已接入，包含：

- [x] 四区域主界面布局（工具栏 / 工作区索引区 / 内容区 / 状态栏）
- [x] 空工作区状态展示（idle / loading / ready / error 四种状态）
- [x] Tauri command 统一调用封装
- [x] Rust 健康检查命令（前后端桥接验证）
- [x] 前后端共享类型定义（WorkspaceInfo、IndexEntry、CommandResponse 等）
- [x] 双栏编辑 / 无感预览模式切换（界面占位，渲染逻辑待实现）
- [x] CommandResponse + AppErrorPayload 统一响应/错误规范
- [x] 工作区选择闭环（系统文件夹对话框 → Rust 递归扫描 .md/.markdown → 前端展示名称与文件数）
- [x] 工作区 scanner 模块（跳过隐藏目录、符号链接、不可读路径，大小写不敏感）
- [x] lucide-react 矢量图标（替代 emoji，适配浅色/深色主题）
- [x] 索引树构建（Rust indexer 模块：将扁平扫描结果递归构建为 IndexTreeNode 目录树）
- [x] 侧边栏目录树渲染（支持目录折叠/展开、文件节点点击占位回调、长列表滚动）
- [x] 文档打开闭环（索引树文件点击 → Rust 路径校验 → 读取 .md/.markdown → 前端展示标题与原始内容）
- [x] 文档 reader 模块（路径越界防护、扩展名校验、文件大小限制 10MB、UTF-8 编码检测）
- [x] 当前文档在索引树中的高亮标记
- [x] 文档编辑器（可编辑 textarea 替代只读占位）
- [x] 文档保存闭环（工具栏保存按钮 + Cmd/Ctrl+S 快捷键 + isDirty 跟踪 + 保存中状态）
- [x] 文档 writer 模块（路径越界防护、扩展名校验、写入权限检查）
- [x] 未保存保护（切换文档/工作区时提示先保存）
- [x] 状态栏保存状态显示（已保存/未保存/保存中/保存失败）
- [x] 新建文档（临时态 isNew → 编辑 → 首次保存走另存为选择路径 → 落盘切换身份）
- [x] 另存为（系统保存对话框 → 写入新路径 → 切换文档身份 → 工作区内路径自动刷新索引）
- [x] 索引刷新命令（refresh_workspace_index 复用 scanner + indexer 重建索引）
- [x] 工具栏新建/另存为按钮 + Cmd/Ctrl+N / Cmd/Ctrl+Shift+S 快捷键
- [x] Markdown 渲染服务（marked + DOMPurify + KaTeX，覆盖 13 类语法 + 公式 + 资源解析）
- [x] 双栏编辑模式预览区实时渲染（替换 pre 占位为 HTML 渲染）
- [x] 无感渲染模式（沉浸式阅读，与双栏共用渲染服务）
- [x] 公式渲染（行内 $...$ 和块级 $$...$$，KaTeX，失败保留原始文本）
- [x] 相对路径资源解析（图片相对路径、内部 .md 链接、外部链接识别）
- [x] 渲染错误收集与降级反馈（图片/公式失败占位 + 状态栏错误计数）
- [x] 模式切换状态保持（切换只切视图，保留编辑内容、渲染结果、滚动位置）
- [x] 状态持久化与最近工作区/文档/模式恢复（启动加载 settings.json，恢复失败安全降级到空工作区，模式/工作区/文档变更时同步持久化）
- [x] 未保存切换确认对话框（切换工作区/切换文档/关闭窗口时统一确认，三选项：保存并继续/不保存并继续/取消，lucide-react 图标，键盘 Esc/Enter/遮罩支持）
- [x] 状态栏与工具栏联动（状态栏展示工作区/文档名/模式/索引四态/保存状态/渲染错误；工具栏按钮按 workspaceState/isDirty/isSaving/isNew 联动启用禁用）
- [x] 渲染缓存（useRender 基于 content hash + LRU 20 条，模式切换与重复打开复用渲染结果）
- [x] 渲染节流/防抖（App.tsx 250ms 防抖 + 模式/文档切换立即渲染出口；6 个 vi.useFakeTimers 行为测试覆盖连续输入/立即渲染/缓存命中/定时器取消）
- [x] 文件监听与索引自动刷新（Rust notify watcher 监听 .md/.markdown 新增/删除/修改，300ms 去抖后 emit workspace://index-changed 事件，前端收到事件后调用 refresh_workspace_index 全量重建；watcher 失败安全降级到手动刷新；切换工作区时停旧 watcher、启新 watcher）
- [x] 索引树展开状态外部化（Sidebar 管理 expandedIds，IndexTree 受控展开，索引刷新后保持用户已展开目录）
- [x] 前端单元测试（101 测试覆盖渲染/公式/资源解析/启动恢复链路/组件级恢复时序/未保存确认对话框与 save-as 路径/状态栏四态/工具栏按钮联动/渲染防抖行为/watcher 事件联动/索引树展开状态）

**尚未实现**（后续阶段接入）：
- 超长文档分段渲染/虚拟化（T37）
- 文档切换 loading 占位与骨架复用（T38）
- 异常恢复收尾：保存失败/索引失败/图片失败的统一恢复路径（T39）

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/) >= 1.77

### 安装与运行

```bash
# 安装前端依赖
pnpm install

# 启动 Tauri 开发模式（前端 + 桌面窗口）
pnpm tauri dev
```

## ZCode Bridge

仓库内提供了一个独立 CLI，用来桥接本机安装的 ZCode，会话查询和给指定 session 发消息都走 ZCode 自带的 `app-server` 协议，不直接写它的本地数据库。

```bash
# 健康检查
pnpm zcode:bridge doctor

# 查看当前工作区下的 ZCode sessions
pnpm zcode:bridge list-sessions

# 只做匹配校验，不真正发送
pnpm zcode:bridge send --session "coding-agent" --message "继续处理 handoff 里的实现任务" --dry-run

# 真实发送，默认会等待该次 prompt 跑完再退出
pnpm zcode:bridge send --session "coding-agent" --message "继续处理 handoff 里的实现任务"
```

可选参数：

- `--workspace <path>`: 指定 workspace 路径，默认是当前目录
- `--all`: 不按 workspace 过滤，跨所有 ZCode session 搜索
- `--json`: 输出 JSON，便于别的脚本接入
- `--message -`: 从 stdin 读取消息正文
- `--no-wait`: 发送后立即退出；默认会持续轮询，直到这次 prompt 结束或超时
- `--wait-poll-ms <ms>`: `send` 等待期间的 `session/read` 轮询间隔，默认 `500`
- `--wait-timeout-ms <ms>`: `send` 最长等待时间，默认 `1200000`（20 分钟）

如果你的 ZCode 安装路径不是默认值 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，先设置环境变量：

```bash
export ZCODE_CLI_PATH="/path/to/zcode.cjs"
export ZCODE_CONFIG_PATH="/path/to/.zcode/v2/config.json"
export ZCODE_MESSAGE_DB_PATH="/path/to/.zcode/cli/db/db.sqlite"
export ZCODE_TASKS_INDEX_PATH="/path/to/.zcode/v2/tasks-index.sqlite"
```

### 构建

```bash
pnpm build      # 前端构建
pnpm tauri build # 桌面应用构建
```

### 运行 Rust 测试

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## 项目结构

```
RuT0MarkFlow/
├── docs/                  # 需求、交互、技术设计、开发任务文档
├── handoff/               # 审查交接文件（HANDOFF + VERIFICATION REPORT）
├── src/                   # 前端源码（React + TypeScript + Vite）
│   ├── app/               # 应用主组件
│   ├── components/        # UI 组件
│   │   ├── layout/        # 整体布局
│   │   ├── toolbar/       # 顶部工具栏
│   │   ├── sidebar/       # 左侧工作区索引
│   │   ├── content/       # 中央内容区
│   │   └── statusbar/     # 底部状态栏
│   ├── modules/           # 业务模块
│   │   ├── workspace/     # 工作区状态管理
│   │   └── document/      # 文档打开逻辑
│   ├── services/tauri/    # Tauri command 调用封装
│   ├── types/             # TypeScript 类型定义
│   └── styles/            # CSS 样式
├── src-tauri/             # Rust 后端（Tauri）
│   ├── src/
│   │   ├── commands/      # Tauri 命令实现
│   │   ├── models/        # 数据模型
│   │   └── modules/       # 业务模块（workspace/scanner/indexer, document/reader, errors）
│   └── tauri.conf.json    # Tauri 配置
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 技术栈

- **桌面壳层**: [Tauri](https://tauri.app/) v2
- **后端**: Rust
- **前端**: React 18 + TypeScript + Vite
- **包管理**: pnpm
