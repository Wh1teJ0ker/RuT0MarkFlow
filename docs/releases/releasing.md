# 发布运维指南

本文档记录 RuT0MarkFlow 的发布运维细节，包括 WebView2 运行时策略、Release 产物命名规则、Updater 签名密钥配置和发布矩阵构建命令。

日常开发与测试命令见根目录 `README.md`。

## 1. WebView2 运行时策略

本应用采用 `skip` 模式（不在安装包内嵌入或下载 WebView2 安装程序）。这意味着：
- **Windows 安装版和便携版均不包含 WebView2 静默安装程序**，双击即用。
- 目标机器需装有 WebView2 运行时（Windows 10 1803+ / Windows 11 已预装，更早版本需要手动安装）。
- macOS 和 Linux 使用系统内置 WebKit，不受此配置影响。

## 2. Release 产物命名规则

GitHub Release 产物命名采用 Tauri 内置令牌模板，规则如下：

```
[name]_[version]_[platform]_[arch]_[setup][ext]
```

各令牌含义说明：

| 令牌 | 说明 | 示例值 |
|------|------|--------|
| `[name]` | 项目名称（小写） | `rut0markflow` |
| `[version]` | 版本号（不含 v 前缀） | `0.1.0` |
| `[platform]` | 目标平台 | `ubuntu`（Linux 构建机）、`windows`、`macos` |
| `[arch]` | CPU 架构 | `x64`、`aarch64` |
| `[setup]` | 安装程序后缀（仅 NSIS 安装包生效） | macOS/Linux 下为空字符串；Windows NSIS 为 `-setup` |
| `[ext]` | 文件扩展名 | `.dmg`、`.exe`、`.deb`、`.AppImage` |

注意事项：
- 在 Linux 构建机上，`[platform]` 解析为 `ubuntu`（而非 `linux`），因为 GitHub Actions 的 `ubuntu-latest` 运行器标识。
- macOS 和 Linux 的 `[setup]` 令牌为空，因此产物文件名为 `[name]_[version]_[platform]_[arch].[ext]`（如 `rut0markflow_0.1.0_macos_aarch64.dmg`）。
- Windows NSIS 安装版产物文件名为 `[name]_[version]_[platform]_[arch]-setup.exe`（如 `rut0markflow_0.1.0_windows_x64-setup.exe`）。
- Windows 额外发布独立便携版，命名模式为 `[name]_[version]_[platform]_[arch]_portable.exe`，不包含 `[setup]` 令牌。
- 便携版无需安装直接运行，依赖系统已安装的 WebView2 运行时（Windows 10 1803+ / Windows 11 已预装）。
- macOS 自动更新依赖 `app` 目标生成的 `RuT0MarkFlow.app.tar.gz` 与对应 `.sig`；对外给用户下载的安装包仍以 `.dmg` 为主。

## 3. 发布矩阵构建

### 按发布矩阵构建

```bash
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg
pnpm tauri build --target x86_64-apple-darwin --bundles app,dmg
pnpm tauri build --bundles deb,appimage
```

以上命令用于正式 release 构建，执行前需先提供 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，否则 updater 签名产物不会生成。

### 发布流水线

发布流水线通过 Git tag `v*` 触发；版本号需先同步到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`version-manifest.json` 和 `src/version.ts`。

## 4. Updater 签名密钥

Tauri 内置更新器（updater）使用 minisign 签名机制对更新包进行签名验证。发布流水线在构建时需要通过两个 GitHub Secrets 传入签名密钥。

### 生成密钥对

在项目根目录执行以下命令生成密钥对：

```bash
pnpm tauri signer generate -p <your-password> -w .tauri/signing-key.key
```

参数说明：
- `-p <your-password>`：私钥密码，用于保护私钥文件
- `-w .tauri/signing-key.key`：私钥输出路径
- `-f`：覆盖已存在的密钥文件（重新生成时使用）

执行后会在 `.tauri/` 目录下生成两个文件：
- `signing-key.key`：**私钥文件（绝不可提交到 Git）**
- `signing-key.key.pub`：公钥文件（内容已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 字段）

### GitHub Secrets 配置

在 GitHub 仓库的 **Settings > Secrets and variables > Actions** 中配置以下两个 Secret：

| Secret 名称 | 值 |
|-------------|-----|
| `TAURI_SIGNING_PRIVATE_KEY` | `.tauri/signing-key.key` 文件的全部文本内容（base64 编码的 minisign 私钥） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时使用的密码（即 `-p` 参数的值） |

### 注意事项

- **私钥绝对不能提交到 Git 仓库**。`.tauri/` 目录已配置在 `.gitignore` 中，生成密钥后请勿手动移除该忽略规则。
- 如果重新生成密钥对，会导致旧公钥失效——已发布的 Release 将无法通过新公钥验证。请在首次发布前完成密钥生成，避免中途更换。
- 公钥已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 字段，格式为 base64 编码的 minisign 公钥。
- 私钥丢失或密码遗忘后无法恢复，请妥善保管私钥文件和密码。
