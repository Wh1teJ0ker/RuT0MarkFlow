# Rust 与 Tauri 审计

## 1. 审计结论

后端在相对于给定 root 的普通路径穿越、扩展名限制、读取大小限制和扫描 symlink 跳过方面有基础防护，但“root 是否为用户授权工作区”没有由 Rust 持有，导致权限模型本身可被前端伪造。

发现：
- 严重：2 项
- 高：4 项
- 中：8 项
- 低：4 项

## 2. 严重问题

### BE-C1：调用方可伪造任意工作区 root 并读取 Markdown

位置：
- `src-tauri/src/commands/document.rs:21-29`
- `src-tauri/src/modules/document/reader.rs:25-39`
- `src-tauri/src/commands/workspace.rs:213-217,248-255`

reader 只验证目标在调用方声明的 root 内；root 本身未与 Rust state 中的用户授权工作区绑定。WebView 一旦被攻破，可把用户主目录或 `/` 声明为 root，再扫描和读取其中 Markdown。

建议：Rust state 保存 canonical current workspace；只有系统目录选择建立授权。后续命令从 state 取 root，或使用不可伪造 workspace token。

### BE-C2：另存为可绕过 picker 覆盖任意 `.md/.markdown` 路径

位置：
- `src-tauri/src/commands/document.rs:141-159`
- `src-tauri/src/modules/document/writer.rs:45-75,92-112`

`save_document_as` 接受裸 target_path，未证明来自系统保存对话框。`pick_save_path` 和写入是独立命令，调用者可跳过 picker。writer 中 `if is_within && !canonical.starts_with(root)` 条件永远为假。

建议：在 Rust 内合并选择与写入，或 picker 返回单次短期 token；普通保存只能写受控 workspace。

## 3. 高严重度问题

### BE-H1：文件覆盖写不是原子操作
位置：`src-tauri/src/modules/document/writer.rs:11-12,98-112`。

`File::create` 先截断，写入失败、磁盘满、崩溃或断电可留下空/半文件。`flush` 不等同持久化。

建议：同目录临时文件，write + flush + sync_all，原子 replace，失败保留原文件并清理临时文件。

### BE-H2：路径检查与写入间存在 symlink/TOCTOU
位置：`writer.rs:17-42,54-75,92-100`。

canonicalize 后再通过路径 File::create，中间目标或父目录可被替换为 symlink/junction，造成工作区外覆盖。

建议：拒绝 symlink，使用 no-follow 和目录句柄相对操作；补 Unix symlink 与 Windows reparse point 测试。

### BE-H3：CSP 禁用且 asset scope 覆盖整个 HOME
位置：`src-tauri/tauri.conf.json:21-25`。

`csp: null` 且 assetProtocol scope 包含 `$HOME/**`，放大 Markdown 注入和前端依赖漏洞的后果。

建议：严格 CSP；移除 `$HOME/**`；本地图片通过受控后端读取或运行时精确 scope。

### BE-H4：本地图片解析没有工作区边界
位置：`src/services/render/resource.ts:38-67,113-127` 与 `tauri.conf.json:23-25`。

相对路径字符串拼接可携带 `../`，绝对路径亦可保留，再交给 convertFileSrc。

建议：资源解析移到 Rust；canonicalize 后要求目标处于受控 workspace，拒绝绝对路径、`..` 和 symlink 逃逸。

## 4. 中严重度问题

### BE-M1：保存无外部修改冲突检测
位置：`reader.rs:86-101`、`writer.rs:98-137`、`commands/document.rs:61-73`。其他编辑器、Git 或同步程序修改后会被静默覆盖。建议 expected_version/hash 乐观锁。

### BE-M2：保存同步执行磁盘 I/O
位置：`commands/document.rs:62-68`、`writer.rs:92-116`。慢盘/网络盘/大内容可能阻塞命令线程。建议 async + spawn_blocking 和内容大小限制。

### BE-M3：扫描无文件数、深度、预算或取消限制
位置：`scanner.rs:35-83`、`workspace.rs:37-82`、`indexer.rs:60-90`。递归可能栈耗尽，旧扫描结果也可能晚到。建议迭代遍历、上限、取消 token/generation、分批结果。

### BE-M4：watcher 切换非原子
位置：`commands/workspace.rs:286-305,311-324`。先停旧 watcher，再建新 watcher；启动失败会失去旧 watcher。mutex 失败也可能返回伪成功。

### BE-M5：watcher 停止不 join 线程
位置：`watcher.rs:25-28,82-96,165-172`。旧工作区事件可能在切换后晚到。建议保存 JoinHandle、停止时 join，并给事件 generation。

### BE-M6：设置保存失败仍返回成功，损坏设置直接删除
位置：`commands/state.rs:26-40`、`persistence.rs:17-48`。写入非原子、错误静默、并发丢更新。建议原子写、真实错误、corrupt 备份和串行化。

### BE-M7：dirty mutex 使用 unwrap
位置：`commands/state.rs:48-50`、`src-tauri/src/lib.rs:22-29`。mutex poison 后关闭保护路径可 panic。该状态可改用 AtomicBool，或保守处理 PoisonError。

### BE-M8：capability 使用宽泛 default 权限
位置：`src-tauri/capabilities/default.json:5-10`。`opener:default`、`dialog:default` 未最小化。建议仅允许实际协议与具体操作。

## 5. 低严重度问题

### BE-L1：错误码契约不统一
`modules/errors/app_error.rs:38-46` 定义常量，但命令大量使用自由字符串如 `DOCUMENT_OPEN_FAILED`、`SCAN_FAILED`。建议 Rust error enum + 稳定映射。

### BE-L2：错误响应暴露绝对路径和 OS 文案
`commands/document.rs:40-80`、`commands/workspace.rs:161-195`。建议 UI 返回相对路径，完整原因写受控日志。

### BE-L3：非 UTF-8 编码回退可能误判并不可逆转码
`reader.rs:105-138` 对 UTF-8 失败尝试 GBK/GB18030，保存始终 UTF-8。建议返回编码、转换前提示或保留原编码，并补其他编码测试。

### BE-L4：时间戳秒精度且 DefaultHasher 非稳定协议
`reader.rs:86-95`、`writer.rs:118-131`。建议纳秒级版本信息与 BLAKE3/SHA-256 等明确算法。

## 6. 主要测试缺口

- 任意 root 伪造和 picker 授权绕过。
- symlink 文件/父目录、Windows junction、TOCTOU。
- 原子保存、磁盘满、短写、rename 失败、权限保留。
- 外部修改冲突和并发保存。
- 真实 watcher start/stop/rename/快速切换。
- 极深目录、十万文件、网络盘、取消旧扫描。
- CSP/capability/asset scope 自动化断言。
- opener 的 file/custom scheme 边界。
- mutex poison、设置并发/损坏备份。
- updater 签名失败、恶意 manifest 和安装失败。

特别说明：`reader.rs:217-227` 的“文件过大”测试没有真正创建超过 10 MB 的文件，需要修正测试有效性。

## 7. 良好项

- reader 对给定 root 做 canonicalize 与 containment 检查。
- scanner 跳过 symlink，减少递归环。
- 文件扩展名限制为 md/markdown。
- 文档读取有 10 MB 上限。
- 扫描和打开使用 spawn_blocking。
- watcher 有扩展名过滤与 debounce。
- updater 使用 HTTPS endpoint 和签名公钥。
- Markdown 首次注入前经过 DOMPurify。
- 未发现生产 Rust unsafe、todo、unimplemented。
- 本次 81 个 Rust 单元测试 + 1 个 pressure integration test 通过，clippy 零警告。

## 8. 未验证项

- 插件 default capability 在锁定版本下的精确 ACL 展开。
- asset protocol 在各平台 WebView 中对 MIME 和同源的实际行为。
- RustSec/CVE 状态，因未安装 cargo-audit。
- updater 公钥与远端签名私钥匹配。
- macOS entitlement、Windows installer ACL、Linux bundle 权限。
- watcher 在真实 FSEvents/inotify/ReadDirectoryChangesW 上的行为。
