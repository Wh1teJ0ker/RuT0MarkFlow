task_id: PT1
goal: |
  为 1000+ Markdown 文件工作区建立可复现的压测方案、执行并落盘结果，同时补齐前端 loading 可感知性的自动化证据和验收文档。
in_scope:
  - scripts/
  - package.json
  - src/app/__tests__/
  - src-tauri/src/modules/workspace/
  - src-tauri/src/commands/workspace.rs
  - docs/05-验收记录.md
  - handoff/FINAL-ACCEPTANCE.md
  - handoff/
out_of_scope:
  - Markdown 渲染管线重写
  - 编辑器交互功能新增
  - 无关 UI 样式调整
  - 与本任务无关的基础设施工具改动
acceptance_criteria:
  - 存在一个可执行的压测入口，能够在本机生成或使用 >=1000 个 Markdown 文件的工作区样本并输出文件数、扫描/索引耗时、关键结论
  - 压测结果证明 1000+ 文件工作区扫描与索引构建可完成，且结果被写入仓库文档或 handoff 报告，不是只在终端口头说明
  - 至少有一条自动化测试覆盖“工作区扫描进行中时，UI 显示 loading/扫描中状态且主界面未进入崩溃或不可用状态”
  - docs/05-验收记录.md 中 11.4.1 / 11.4.2 的状态与新压测证据保持一致
  - 如果新证据足以关闭剩余 ⚠️，则同步更新 handoff/FINAL-ACCEPTANCE.md；如果仍不能关闭，必须准确写明还缺什么证据
verification_commands:
  - node scripts/pressure-test-workspace.mjs
  - pnpm test -- --run
  - pnpm build
  - cargo test --manifest-path src-tauri/Cargo.toml
  - cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
files_likely_to_change:
  - scripts/pressure-test-workspace.mjs
  - package.json
  - src/app/__tests__/workspace-pressure-loading.test.tsx
  - src-tauri/src/modules/workspace/scanner.rs
  - src-tauri/src/modules/workspace/indexer.rs
  - docs/05-验收记录.md
  - handoff/FINAL-ACCEPTANCE.md
risks:
  - 时间阈值如果写得过死，容易在不同机器上产生脆弱失败
  - 仅后端扫描耗时不足以证明前端可交互，需要补充 loading 态证据
  - 压测生成大量临时文件时要确保清理，避免污染仓库
depends_on: []
status: planned
