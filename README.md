# Cursor Light

Cursor Light 是一个轻量级 Electron 桌面状态灯工具，用于监听 Cursor hooks，并通过红、黄、绿三色灯实时显示 Agent 当前状态。它适合放在屏幕角落，帮助你不用盯着 Cursor 面板也能知道 Agent 正在执行、已经完成，还是遇到了错误。

![Cursor Light screenshot](docs/screenshot.svg)

## 功能特性

- 监听 Cursor hooks，通过本地 HTTP 接收器更新灯色
- 红灯、黄灯、绿灯状态显示
- 始终置顶，适合做屏幕角落悬浮提示
- 支持拖动，靠近屏幕边缘自动吸附
- 支持右键切换横向和竖向布局
- 按屏幕尺寸自适应窗口大小
- 提供 Windows 安装包和便携版 exe 打包配置

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
- Cursor

### 安装依赖

```powershell
npm.cmd install
```

### 启动应用

```powershell
npm.cmd start
```

应用会启动本地 hook 接收器：

```text
http://127.0.0.1:18765/hook
```

### 模拟灯色

```powershell
npm.cmd run simulate:yellow
npm.cmd run simulate:green
npm.cmd run simulate:red
```

## Cursor Hooks 配置

Cursor Light 通过 `hooks/cursor-hook.js` 把 Cursor hook 事件转发给桌面灯条。你可以在 Cursor 的全局配置中添加：

```text
C:\Users\<你的用户名>\.cursor\hooks.json
```

示例配置：

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "node D:\\DevWorkspace\\cursor-light\\hooks\\cursor-hook.js --event=beforeSubmitPrompt --status=yellow"
      }
    ],
    "afterAgentThought": [
      {
        "command": "node D:\\DevWorkspace\\cursor-light\\hooks\\cursor-hook.js --event=afterAgentThought --status=yellow"
      }
    ],
    "afterShellExecution": [
      {
        "command": "node D:\\DevWorkspace\\cursor-light\\hooks\\cursor-hook.js --event=afterShellExecution --status=yellow"
      }
    ],
    "afterFileEdit": [
      {
        "command": "node D:\\DevWorkspace\\cursor-light\\hooks\\cursor-hook.js --event=afterFileEdit --status=yellow"
      }
    ],
    "afterAgentResponse": [
      {
        "command": "node D:\\DevWorkspace\\cursor-light\\hooks\\cursor-hook.js --event=afterAgentResponse --status=green"
      }
    ],
    "stop": [
      {
        "command": "node D:\\DevWorkspace\\cursor-light\\hooks\\cursor-hook.js --event=stop --status=green"
      }
    ]
  }
}
```

修改 hooks 配置后，需要重启 Cursor，或执行 `Developer: Reload Window`。已经在运行中的 Agent 请求不会补发开始事件。

## 打包 exe

项目使用 `electron-builder` 打包 Windows exe：

```powershell
npm.cmd install
npm.cmd run dist
```

打包前请先退出正在运行的开发版灯条，否则 Windows 可能会占用 Electron 文件，导致构建卡在解包阶段。

打包产物会生成在 `dist` 目录：

- `Cursor Light-0.1.0-x64-nsis.exe`：安装包
- `Cursor Light-0.1.0-x64-portable.exe`：便携版

## Release 版安装说明

1. 打开 GitHub 仓库的 `Releases` 页面。
2. 下载 `Cursor Light-版本号-x64-nsis.exe` 安装包，或下载 `Cursor Light-版本号-x64-portable.exe` 便携版。
3. 如果使用安装包，双击安装并启动 `Cursor Light`。
4. 如果使用便携版，直接双击 exe 启动。
5. 确认灯条显示在屏幕角落后，配置 Cursor hooks。

安装包默认会把 hook 脚本复制到应用资源目录。默认安装位置通常类似：

```text
%LOCALAPPDATA%\Programs\Cursor Light\resources\hooks\cursor-hook.js
```

对应 hook 命令示例：

```powershell
node "$env:LOCALAPPDATA\Programs\Cursor Light\resources\hooks\cursor-hook.js" --event=beforeSubmitPrompt --status=yellow
```

如果安装时选择了其他目录，请把命令中的脚本路径改成实际安装路径。hook 脚本需要系统能执行 `node` 命令。

## 常用脚本

```powershell
npm.cmd start
npm.cmd run dist
npm.cmd run simulate:yellow
npm.cmd run simulate:green
npm.cmd run simulate:red
```

## 许可证

MIT
