# 需求文档符合度收尾 HANDOFF — 7 项不符合项一次性补齐

- **status**: superseded (已实施完成，见 handoff/VERIFICATION-REPORT.md 与 handoff/FINAL-ACCEPTANCE.md)
- **author**: code-review-workflow
- **date**: 2026-07-05
- **背景**: 对照 docs/01-需求文档.md 全量审查后，筛选出贴合"本地化、轻量、快速浏览"定位的 7 项不符合项，打包一轮补齐。已主动排除增量索引、视口虚拟化、语法高亮等重项。

---

## goal

一次性补齐需求文档中 7 项不符合项，使应用主流程与交互完整符合 MVP 验收标准：
1. **关闭当前文档（P0）** — 工具栏关闭按钮 + Cmd+W + handleCloseDocument + 未保存确认 + history.clear
2. **Cmd+F 查找（P1）** — 预览区高亮查找 + Esc 关闭
3. **新建文档未保存确认（P2）** — handleNewDocument 改用 requestUnsavedConfirm
4. **模式切换保留光标位置（P2）** — textarea 卸载前存 selectionStart/End，切回恢复
5. **工作区恢复失败重选入口（P2）** — restore 失败时占位区提供"重新选择工作区"按钮
6. **索引排序依据可感知（P2）** — 侧边栏显示当前排序方式（目录优先+字母序）
7. **大工作区扫描进度反馈（P2）** — 扫描期间状态栏显示"正在扫描…"文案强化

---

## in_scope

### A. 关闭当前文档（P0，需求 5.3 / 7 / 11.1）

**`src/app/App.tsx`**：
- 新增 `handleCloseDocument`：
  ```ts
  const handleCloseDocument = useCallback(() => {
    if (document.isDirty) {
      // 异步确认 —— 与 handleSelectWorkspace 一致的模式
      requestUnsavedConfirm().then((action) => {
        if (action === "save") {
          handleSaveDocument().then((saved) => {
            if (saved) doCloseDocument();
          });
        } else if (action === "discard") {
          doCloseDocument();
        }
        // cancel → 不关
      });
      return;
    }
    doCloseDocument();
  }, [document.isDirty, handleSaveDocument]);
  ```
  `doCloseDocument` 清空到"无文档"占位态：
  ```ts
  const doCloseDocument = () => {
    history.clear();
    setDocument({
      path: null, relativePath: null, title: "", content: "",
      lastSavedContent: "", isDirty: false, isSaving: false, isNew: false,
    });
    setSaveError(null);
    setStatusMessage("已关闭当前文档");
  };
  ```
  注：`doCloseDocument` 可内联在 handleCloseDocument 闭包内，或独立 useCallback；推荐独立以便测试。

- 键盘 effect（`App.tsx:583-614`）追加分支：
  ```tsx
  } else if (meta && (e.key === "w" || e.key === "W")) {
    e.preventDefault();
    handleCloseDocument();
  }
  ```
  依赖数组追加 `handleCloseDocument`

- `<Toolbar>` 调用传入 `onCloseDocument={handleCloseDocument}` + `hasDocument={hasDocument}`（已有）

**`src/components/toolbar/Toolbar.tsx`**：
- `ToolbarProps` 追加 `onCloseDocument: () => void`
- `toolbar-group--left` 或 `--center` 新增关闭按钮（图标用 lucide-react `X` 或 `FileX`，title "关闭当前文档 (Cmd/Ctrl+W)"），`disabled={!hasDocument}`

**新建测试 `src/app/__tests__/close-document.test.tsx`**：
- isDirty=false → 直接关闭，文档清空，ContentArea 显示"请从左侧索引列表中选择一个文档"
- isDirty=true + cancel → 不关闭
- isDirty=true + save success → 关闭
- isDirty=true + save fail → 不关闭
- Cmd+W 触发 handleCloseDocument（参考 undo-redo.test.tsx 的 keyDown 模式）

### B. Cmd+F 查找（P1，需求 5.5）

**新建 `src/components/content/FindBar.tsx`**：
- 受控组件，props：`{ open: boolean; onClose: () => void; containerRef: RefObject<HTMLDivElement> }`
- UI：输入框 + 上一个/下一个按钮 + 匹配计数 + 关闭按钮（X 图标）
- 行为：
  - 输入关键词后，在 `containerRef.current`（预览区）内高亮所有匹配：用 `window.find(query)` 或自建高亮（遍历文本节点，匹配处包 `<mark class="find-highlight">`）
  - **简化决策**：用 `window.find()` —— 浏览器原生，零依赖，支持上/下一个。但 `window.find()` 已弃用且跨浏览器行为不一。**备选**：自建高亮 —— 在预览区文本节点遍历，匹配处用 `<mark>` 包裹，下一个/上一个通过 `mark` 元素列表索引跳转。
  - **最终决策**：自建高亮（可控、可测试、不依赖废弃 API）
- Esc 关闭（FindBar 内部 keydown 拦截）
- 高亮样式：`.find-highlight { background: #ffeb3b; color: #000; }` `.find-highlight--current { background: #ff9800; }`

**`src/app/App.tsx`**：
- 新增 state `const [isFindBarOpen, setIsFindBarOpen] = useState(false);`
- 键盘 effect 追加：
  ```tsx
  } else if (meta && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    setIsFindBarOpen(true);
  }
  ```
- 传递 `isFindBarOpen` + `onCloseFindBar` + 预览区 ref 给 ContentArea（或直接在 App 层渲染 FindBar 覆盖在 content 区上方）

**`src/components/content/ContentArea.tsx`**：
- Props 追加 `isFindBarOpen: boolean; onCloseFindBar: () => void`
- 在 content-document 内渲染 `<FindBar open={isFindBarOpen} onClose={onCloseFindBar} containerRef={previewRef} />`
- previewRef 需传给 FindBar

**`src/styles/index.css`**：
- `.find-bar` 样式：固定在 content 区顶部、flex 布局、border-bottom
- `.find-highlight` / `.find-highlight--current` 高亮样式
- 深色主题 `.find-highlight` 调整

**新建测试 `src/components/content/__tests__/find-bar.test.tsx`**：
- 输入关键词 → 高亮匹配
- 下一个/上一个切换 current
- Esc 关闭

### C. 新建文档未保存确认（P2，需求 5.3）

**`src/app/App.tsx`**：
- `handleNewDocument`（行 432-445）改造，与 `handleSelectWorkspace` 一致：
  ```ts
  const handleNewDocument = useCallback(async () => {
    if (document.isDirty) {
      const action = await requestUnsavedConfirm();
      if (action === "save") {
        const saved = await handleSaveDocument();
        if (!saved) return;
      }
      if (action === "cancel") return;
    }
    history.clear();
    setDocument({ ... isNew: true });
    setSaveError(null);
    setStatusMessage("新建文档 — 输入内容后保存以落盘");
  }, [document.isDirty, handleSaveDocument, history]);
  ```
- 改为 async（原同步），更新调用方（键盘 effect 已能处理 async）

**测试 `src/app/__tests__/` 现有 `unsaved-confirm.test.tsx` 或新建**：
- isDirty=true → 点新建 → 弹确认 → cancel 不新建 / save 成功后新建 / discard 直接新建

### D. 模式切换保留光标位置（P2，需求 5.4）

**`src/components/content/ContentArea.tsx`**：
- 新增 ref `const selectionRef = useRef<{ start: number; end: number } | null>(null);`
- textarea 的 `onBlur` 或模式切换前保存：
  ```tsx
  onBlur={(e) => {
    selectionRef.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
  }}
  ```
- split-editor textarea 挂载后（useEffect 监听 viewMode 变化）恢复：
  ```tsx
  useEffect(() => {
    if (viewMode === "split-editor" && selectionRef.current && textareaRef.current) {
      textareaRef.current.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
      textareaRef.current.focus();
    }
  }, [viewMode]);
  ```
- 需新增 `textareaRef = useRef<HTMLTextAreaElement>(null)` 并绑到两个 textarea

### E. 工作区恢复失败重选入口（P2，需求 5.1）

**`src/app/App.tsx`**：
- restore effect（行 232-247）失败分支：当前 `setWorkspaceState("idle")`。改为 `setWorkspaceState("error")` + `setWorkspaceError({ code: "RESTORE_FAILED", message: "最近工作区不可用", recoverable: true })`
- 这样 Sidebar 会进入 error 态显示"重新选择工作区"按钮（已有，P1 T39 实现）
- 同时保留清空 settings 的逻辑

**测试**：现有 `restore-state.test.tsx` 中"invalid workspace path clears stale settings"用例需更新断言：workspaceState 应为 "error" 而非 "idle"

### F. 索引排序依据可感知（P2，需求 5.2）

**`src/components/sidebar/Sidebar.tsx`**：
- `sidebar-summary` 区（行 177-185 附近，显示工作区名+文件数）追加排序方式文案：
  ```tsx
  <span className="sidebar-sort-hint" title="当前排序：目录优先 + 字母序">
    <ArrowDownAZ size={11} /> 目录·字母序
  </span>
  ```
  从 lucide-react import `ArrowDownAZ`
- 这只是"显示当前排序策略"，不实现可切换排序（保持轻量）

### G. 大工作区扫描进度反馈（P2，需求 11.4）

**`src/app/App.tsx`**：
- `handleSelectWorkspace`（行 477-508）扫描期间 `setStatusMessage("正在选择工作区…")` 改为更明确的 `"正在扫描 Markdown 文件…"`
- 可选：扫描完成后 `"已加载工作区: X（N 个 Markdown 文件）"`（已有）

**`src/components/sidebar/Sidebar.tsx`**：
- loading 态（行 69-75）文案 `"正在选择工作区…"` 改为 `"正在扫描工作区…"` + 保留 spinner

**Rust 端可选增强**（不强制）：
- `select_workspace` / `load_workspace` 在扫描过程中通过 `app.emit("workspace://scan-progress", { count })` 周期性发送进度 —— **本轮不做**（保持轻量，spinner+文案足够；增量进度需改 Rust 命令为流式，超范围）

---

## out_of_scope

- 不实现增量/持久化索引（推迟，日常 <500 文件无感）
- 不实现视口虚拟化（T37 分段渲染已足够）
- 不实现代码语法高亮（需求未强制）
- 不改首批 chunk 同步渲染为异步（微优化）
- 不实现可切换排序（仅显示当前策略）
- 不实现 Rust 端流式扫描进度（保持轻量）
- 不改 Rust 业务逻辑（除可能的状态码调整）
- 不引入新第三方库
- 不做 README / ErrorBoundary / 拖拽打开（独立轮次）

---

## acceptance_criteria

### A. 关闭当前文档
1. 工具栏有"关闭当前文档"按钮（X 或 FileX 图标），无文档时 disabled
2. `handleCloseDocument` 存在，isDirty 时弹 requestUnsavedConfirm
3. 关闭后进入"工作区已加载、无文档"占位态（ContentArea 显示"请从左侧索引列表中选择一个文档"）
4. 关闭后 history.clear() 被调用
5. `Cmd/Ctrl+W` 触发 handleCloseDocument
6. close-document.test.tsx 4 场景通过（干净关闭/cancel/save成功/save失败）

### B. Cmd+F 查找
7. `Cmd/Ctrl+F` 打开 FindBar
8. FindBar 输入关键词后预览区高亮匹配（`<mark class="find-highlight">`）
9. 下一个/上一个按钮切换 current 高亮
10. Esc 关闭 FindBar 并清除高亮
11. find-bar.test.tsx 通过

### C. 新建文档未保存确认
12. `handleNewDocument` 在 isDirty 时弹 requestUnsavedConfirm（与 handleSelectWorkspace 一致）
13. cancel → 不新建；save 成功 → 新建；discard → 直接新建
14. 现有 unsaved-confirm 或新建测试覆盖

### D. 模式切换保留光标
15. split-editor textarea 有 onBlur 保存 selectionStart/End 到 ref
16. 切到 immersive 再切回 split-editor，光标位置恢复（非默认 0）
17. ContentArea 内部测试或手动验证

### E. 工作区恢复失败重选
18. restore 失败时 workspaceState 设为 "error"（非 "idle"）
19. Sidebar 显示 error 态 + "重新选择工作区"按钮
20. restore-state.test.tsx 对应用例更新断言并通过

### F. 索引排序可感知
21. Sidebar summary 区显示"目录·字母序"排序方式（ArrowDownAZ 图标）

### G. 扫描进度反馈
22. 扫描期间状态栏文案为"正在扫描 Markdown 文件…"或等价明确文案
23. Sidebar loading 态文案为"正在扫描工作区…"

### 全局
24. `pnpm test -- --run` 全部通过（既有 152 + 新增 ~8-10）
25. `pnpm build` 成功
26. `cargo test --manifest-path src-tauri/Cargo.toml` 全部通过
27. `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` 0 警告
28. 无 emoji；新增图标来自 lucide-react

---

## verification_commands

```bash
pnpm test -- --run
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

---

## files_likely_to_change

- `src/app/App.tsx`（handleCloseDocument + Cmd+W + Cmd+F + FindBar state + handleNewDocument 改 async + restore 失败设 error + 状态文案）
- `src/components/toolbar/Toolbar.tsx`（关闭按钮 + props）
- `src/components/content/ContentArea.tsx`（FindBar 渲染 + 光标保存/恢复 + textareaRef）
- `src/components/content/FindBar.tsx`（新建）
- `src/components/sidebar/Sidebar.tsx`（排序方式文案 + loading 文案）
- `src/styles/index.css`（find-bar + find-highlight 样式）
- `src/styles/markdown-dark.css`（find-highlight 深色）

**新建测试：**
- `src/app/__tests__/close-document.test.tsx`
- `src/components/content/__tests__/find-bar.test.tsx`

**更新测试：**
- `src/app/__tests__/restore-state.test.tsx`（restore 失败 → error 态断言）

**文档：**
- `handoff/VERIFICATION-REPORT.md`
- `docs/05-验收记录.md`（更新 5.3 关闭文档、5.5 快捷键、5.4 编辑上下文等条目状态）

---

## risks

1. **Cmd+W 与浏览器/Tauri 关闭标签页冲突**：Tauri webview 中 Cmd+W 默认可能关闭窗口。Rust 端 `lib.rs:19-23` 已拦截 CloseRequested，但 Cmd+W 的键盘事件需前端 `preventDefault()` 抢先。**缓解**：键盘 effect 中 Cmd+W 分支第一时间 `e.preventDefault()`。

2. **window.find 已废弃**：自建高亮方案已规避此风险。

3. **FindBar 高亮破坏预览区 DOM**：遍历文本节点插入 `<mark>` 可能破坏 KaTeX/MathML 渲染。**缓解**：只在 `.markdown-body` 的非代码/非公式文本节点遍历，或用 CSS `::highlight()` API（太新，不用）。简单方案：遍历 `TreeWalker` 文本节点，跳过 `.katex`、`pre code` 子树。关闭 FindBar 时移除所有 `<mark>` 还原。

4. **handleNewDocument 改 async 影响键盘 effect**：原同步调用改为 async，键盘 handler 内 `handleNewDocument()` 返回 Promise 但不 await —— 不影响行为（事件处理器本就不等 await）。**缓解**：确认键盘 effect dep 数组更新。

5. **restore 失败改 error 态的副作用**：原 idle 态下用户可正常点"打开工作区"重新选；改 error 态后 Sidebar 显示重选按钮，行为等价但视觉不同。**缓解**：测试覆盖。

6. **光标恢复在 React 受控 textarea 的时序**：useEffect 恢复 setSelectionRange 需在 React 完成 DOM 更新后。**缓解**：useEffect 在 commit 后执行，时序正确；若不生效改用 `useLayoutEffect`。

---

## status

superseded — 已于 2026-07-06 由 coding-agent-workflow 实施完成并通过 code-review-workflow 最终验收（25/25 = 100%）。详见 handoff/VERIFICATION-REPORT.md 与 handoff/FINAL-ACCEPTANCE.md。
