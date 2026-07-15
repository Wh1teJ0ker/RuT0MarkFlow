<p align="center">
  <img src="src-tauri/icons/128x128.png" width="128" height="128" alt="RuT0MarkFlow">
</p>

<h1 align="center">RuT0MarkFlow</h1>

<p align="center">
  本地优先的 Markdown 工作区桌面应用 · 面向知识整理、技术文档维护和长文档阅读/编辑场景
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-orange?style=flat" alt="Tauri 2"> <img src="https://img.shields.io/badge/Rust-stable-dea584?style=flat" alt="Rust"> <img src="https://img.shields.io/badge/React-18-61dafb?style=flat" alt="React 18"> <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat" alt="TypeScript 5"> <img src="https://img.shields.io/badge/Vite-6-646cff?style=flat" alt="Vite 6"> <img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="MIT License"> <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat" alt="v0.1.0">
</p>

---

## 产品简介

- 工作区驱动：选择本地文件夹后自动扫描 Markdown 文件，按目录层级建立索引。
- 双模式体验：支持无感编辑模式（类 Typora 渲染态直接编辑）和双栏编辑模式（左编辑右预览），一键切换。
- 本地内容友好：支持相对路径图片、相对链接、工作区内 Markdown 跳转、KaTeX 公式渲染。
- 面板可拖拽：侧边栏、双栏编辑器/预览区宽度均可自由拖拽缩放，比例持久化。
- 稳定性优先：围绕长文档可用性、状态恢复、版本同步和发布门禁持续收口。

## 技术栈

- 桌面壳：Tauri 2、Rust stable、Cargo
- 前端：React 18、TypeScript 5、Vite 6、Vitest
- Markdown 渲染：marked、DOMPurify、KaTeX
- 桌面能力：`@tauri-apps/api`、`tauri-plugin-dialog`、`tauri-plugin-opener`、`tauri-plugin-log`、`notify`
- 版本元数据：`version-manifest.json` + `scripts/check-version-sync.mjs`

## 快速开始

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

## 构建与测试

### 本机构建

```bash
pnpm build
pnpm tauri build
```

### 测试命令

```bash
pnpm version:check -- --tag v0.1.0
pnpm repo:check
pnpm test
pnpm build
pnpm pressure:test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

发布其他版本时，将 `v0.1.0` 替换为对应的 Git tag。

## 发布

发布运维细节（WebView2 运行时策略、Release 产物命名规则、按发布矩阵构建命令、Updater 签名密钥配置、Windows 便携版 `_portable.exe` 命名）见 [`docs/releases/releasing.md`](docs/releases/releasing.md)。

## License

MIT
