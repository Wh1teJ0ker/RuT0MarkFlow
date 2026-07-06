# tests/fixtures/ — 测试样例集

本目录包含 RuT0MarkFlow MVP 验收与性能测试用的 Markdown 样例文件。
每个样例对应需求文档 (`docs/01-需求文档.md`) 中的一个或多个验收点。

## 文件清单

| 文件 | 用途 | 对应验收点 |
|------|------|-----------|
| `comprehensive-syntax.md` | 覆盖 6.1 节全部 13 类 Markdown 语法的综合文档，用于验证渲染完整性与正确性 | 11.2.4 — 常见语法渲染 |
| `math-formulas.md` | 行内公式 + 块级公式 + 故意错误公式，用于验证 KaTeX 渲染与容错 | 11.2.5 — 公式渲染 |
| `long-document.md` | ≥10000 行 / ~1MB 的超长文档，用于 T37 超长文档性能基线测试 | 11.4.3 — 超长文档性能 |
| `multi-level-workspace/` | 多级目录工作区样例（≥2 层子目录 + ≥3 个 .md 文件），用于索引构建与文档间跳转验证 | 11.1.3 — 自动扫描与索引、11.3.1 — 索引建立、11.3.2 — 索引更新 |

## 使用方式

- 在 Tauri 应用中选择 `tests/fixtures/multi-level-workspace/` 作为工作区，验证索引是否正确包含所有层级的 .md 文件
- 打开 `comprehensive-syntax.md` 验证常见 Markdown 语法渲染是否完整
- 打开 `math-formulas.md` 验证公式渲染与错误公式的降级显示
- `long-document.md` 供 T37 实施后做性能对比基线