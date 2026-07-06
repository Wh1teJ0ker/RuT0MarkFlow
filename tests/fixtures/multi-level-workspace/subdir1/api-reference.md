# API 参考

本文档描述了系统的核心 API 接口。

## 文档操作

### openDocument

打开指定路径的 Markdown 文档。

**参数**：
- `rootPath` — 工作区根路径
- `relativePath` — 文档相对路径

**返回**：文档内容、路径、更新时间

### saveDocument

保存当前文档内容到文件。

**参数**：
- `savePath` — 保存路径
- `content` — 文档内容

**返回**：保存结果状态

## 工作区操作

### loadWorkspace

加载指定路径的工作区。

**参数**：
- `path` — 工作区路径

**返回**：工作区信息 + 索引树

### refreshWorkspaceIndex

刷新当前工作区的文件索引。

**返回**：更新后的索引树

---

返回 [首页](../index.md)