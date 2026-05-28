# Cursor Light

Cursor Light 是一个轻量级 Tauri 桌面状态灯工具，用于监听 Cursor hooks，并通过红、黄、绿三色灯实时显示 Agent 当前状态。它适合放在屏幕角落，帮助你不用盯着 Cursor 面板也能知道 Agent 正在执行、已经完成，还是遇到了错误。

![Cursor Light screenshot](docs/screenshot.svg)

## 功能特性

- 监听 Cursor hooks，通过本地 HTTP 接收器更新灯色
- 红灯、黄灯、绿灯状态显示
- 始终置顶，适合做屏幕角落悬浮提示
- 支持拖动，靠近屏幕边缘自动吸附
- 支持右键切换横向和竖向布局
- 支持右键退出，并显示在 Windows 任务栏中
- 首次启动可自动配置 Cursor hooks
- 按屏幕尺寸自适应窗口大小
- Tauri 原生壳，便携版 exe 体积远小于 Electron 版本
- hook 命令直接调用 exe，不再要求用户额外安装 Node.js

## 状态含义

| 灯色 | 含义 |
| --- | --- |
| 绿灯 | 空闲、完成、成功 |
| 黄灯 | Agent 正在执行、思考、调用工具或命令 |
| 红灯 | 失败、拒绝、取消或异常 |

## 本地开发

### 环境要求

- Windows
- Node.js 22+
- npm
- Rust stable
- Visual Studio 2022 Build Tools，包含 `Desktop development with C++`
- WebView2 Runtime，Windows 11 通常自带

### 安装依赖

```powershell
npm.cmd install
```

如果 Rust 拉取 crates.io 较慢，可以使用项目内置的 `.cargo/config.toml`，它已经配置了 USTC 镜像。

### 启动开发版

普通 PowerShell 可能找不到 MSVC linker。建议通过 VS 开发环境启动：

```powershell
$vsPath = & 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe' -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
cmd /c "call `"$vsPath\Common7\Tools\VsDevCmd.bat`" -arch=x64 -host_arch=x64 && cd /d D:\DevWorkspace\cursor-light && npm.cmd start"
```

### 模拟灯色

应用启动后，在另一个终端运行：

```powershell
npm.cmd run simulate:yellow
npm.cmd run simulate:green
npm.cmd run simulate:red
```

## Cursor Hooks 配置

Cursor Light 的 Tauri 版本不再依赖 `node hooks/cursor-hook.js`。自动配置会直接把当前 exe 写入 hooks 命令：

```text
"C:\Path\To\Cursor Light.exe" --hook --event=beforeSubmitPrompt --status=yellow
```

应用启动时会检查：

```text
C:\Users\<你的用户名>\.cursor\hooks.json
```

如果没有检测到当前 exe 对应的 hook 配置，会先弹窗询问是否自动配置。选择 `自动配置` 后，应用会合并写入 hooks 配置，并备份旧文件为：

```text
C:\Users\<你的用户名>\.cursor\hooks.json.bak
```

配置完成后，需要重启 Cursor，或在 Cursor 中执行：

```text
Developer: Reload Window
```

已经在运行中的 Agent 请求不会补发开始事件。如果首次启动时选择跳过，也可以右键灯条，选择 `配置 Cursor Hooks` 重新触发自动配置。

## 打包 exe

默认打包为便携版 exe，不依赖 NSIS 下载：

```powershell
npm.cmd run dist
```

产物会生成在：

```text
dist\Cursor Light-0.1.0-x64-portable.exe
```

如果需要安装包，可以在网络能够访问 GitHub release 资源时运行：

```powershell
npm.cmd run dist:installer
```

如果你的网络访问 GitHub 需要代理，请先在当前 PowerShell 会话设置代理：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
```

## Release 版安装说明

1. 打开 GitHub 仓库的 `Releases` 页面。
2. 下载 `Cursor Light-版本号-x64-portable.exe`。
3. 双击 exe 启动。
4. 首次启动时选择 `自动配置`。
5. 重启 Cursor，或执行 `Developer: Reload Window`。
6. 新发起一个 Agent 请求，灯条就会根据 hook 事件切换颜色。

## 常用脚本

```powershell
npm.cmd start
npm.cmd run dist
npm.cmd run dist:installer
npm.cmd run simulate:yellow
npm.cmd run simulate:green
npm.cmd run simulate:red
```

## 许可证

MIT
