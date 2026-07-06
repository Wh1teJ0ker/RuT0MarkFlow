goal: |
  补齐 RuT0MarkFlow 对 docs/01-需求文档.md 中 11.4.1 / 11.4.2 的 1000+ Markdown 文件工作区压测证据，使性能与稳定性章节不再只停留在架构推断。
tasks:
  - id: PT1
    title: 建立可复现的 1000+ 文件工作区压测基线并落盘结果
    depends_on: []
    status: verified_complete
    handoff: handoff/TASK-PT1-HANDOFF.md
e2e_acceptance:
  - 有一个可复现的压测入口，能生成或使用 1000+ Markdown 文件工作区并输出扫描/索引关键结果
  - 有测试或可执行证据证明扫描期间前端处于可感知 loading 状态，而不是阻塞主流程
  - docs/05-验收记录.md 与 handoff/FINAL-ACCEPTANCE.md 同步到最新压测结论
e2e_verification:
  - node scripts/pressure-test-workspace.mjs
  - pnpm test -- --run
  - pnpm build
  - cargo test --manifest-path src-tauri/Cargo.toml
  - cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
