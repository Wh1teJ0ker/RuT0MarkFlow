# RuT0MarkFlow

RuT0MarkFlow 是一个本地优先的 Markdown 工作区桌面应用，面向知识整理、技术文档维护和长文档阅读/编辑场景。它以文件夹作为工作区入口，提供 Markdown 索引浏览、双模式编辑/预览、公式与相对资源渲染，以及最近工作区/文档/模式恢复能力。

## 产品简介

- 工作区驱动：选择本地文件夹后自动扫描 Markdown 文件，按目录层级建立索引。
- 双模式体验：支持无感渲染模式和双栏编辑模式，兼顾阅读体验与编辑效率。
- 本地内容友好：支持相对路径图片、相对链接、工作区内 Markdown 跳转、KaTeX 公式渲染。
- 稳定性优先：围绕长文档可用性、状态恢复、版本同步和发布门禁持续收口。

## 技术栈

- 桌面壳：Tauri 2、Rust stable、Cargo
- 前端：React 18、TypeScript 5、Vite 6、Vitest
- Markdown 渲染：marked、DOMPurify、KaTeX
- 桌面能力：`@tauri-apps/api`、`tauri-plugin-dialog`、`tauri-plugin-opener`、`notify`
- 版本元数据：`version-manifest.json` + `scripts/check-version-sync.mjs`

## 本地开发方式

### 环境准备

- Node.js 22+
- pnpm 9
- Rust stable（建议安装 `clippy`）
- Linux 构建机需要 Tauri WebKit 依赖，参考 `.github/workflows/release.yml`

### 启动桌面开发环境

```bash
pnpm install
pnpm tauri dev
```

### 仅启动前端调试

```bash
pnpm dev
```

## 桌面编译 / 构建方式

### 本机构建

```bash
pnpm build
pnpm tauri build
```

### 按发布矩阵构建

```bash
pnpm tauri build -- --target aarch64-apple-darwin --no-sign
pnpm tauri build -- --target x86_64-apple-darwin --no-sign
pnpm tauri build -- --no-sign
```

发布流水线通过 Git tag `v*` 触发；版本号需先同步到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`version-manifest.json` 和 `src/version.ts`。

## 测试命令

```bash
pnpm version:check -- --tag v0.1.1
pnpm repo:check
pnpm test
pnpm build
pnpm pressure:test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

发布其他版本时，将 `v0.1.1` 替换为对应的 Git tag。

## Release 产物说明

- GitHub Release 会继续发布 Tauri 常规 bundle，命名模式为 `[name]_[version]_[platform]_[arch]_[bundle][setup][ext]`。
- Windows 额外发布独立便携版资产，命名模式为 `[name]_[version]_[platform]_[arch]_portable[ext]`。
- 当前便携版资产示例：`RuT0MarkFlow_0.1.1_windows_x64_portable.exe`。
- 常规 bundle 适合安装分发；便携版适合直接下载运行，但仍依赖目标机器具备对应平台运行时。

## License

MIT
