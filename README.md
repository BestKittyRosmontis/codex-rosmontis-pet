# Codex 迷迭香余额挂件

**这是在已有 Codex 龙娘挂件基础上的部分修改与同人改编，不是从零原创。**

直接改编来源是 [rattlesdike 的 Codex Dragon Pet 分享包 v1.0.0](https://github.com/rattlesdike/codex-dragon-pet-share/releases/tag/v1.0.0)，底层挂件与 Codex 适配沿用 [MeteorNOX / DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 及其协作成果。原作者、许可和素材来源见 [PROVENANCE.md](PROVENANCE.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。本仓库由 [BestKittyRosmontis](https://github.com/BestKittyRosmontis) 维护这部分修改。

![迷迭香挂件形象](assets/rosmontis.png)

## 修改了什么

- 将默认白紫 GPT 龙娘换为迷迭香同人形象：银灰发、绿眼、猫耳、深蓝与青绿色服装，整理头发并去掉耳机。图片经过 AI 生成与修改，属于非官方同人改编。
- 替换为 48 条短互动台词，包含俏皮吐槽、轻微嘴欠和对 AI 编答案的自嘲；台词是玩笑，不是事实说明，也不是原作官方台词。可在 [docs/dialogue.json](docs/dialogue.json) 查看。
- 改为独立的 `rosmontis-pet` 插件与数据目录，更新名称、图标和托盘文字。
- 修复 Windows 启动：插件的 MCP 服务加载时启动或复用挂件，并使用 PowerShell，避免系统缺少 VBS 引擎时无法启动。新增 `.cmd` 安装与启停入口。1.0.4 还修正了商店版 Codex 的路径隔离，并同步已有挂件启动任务到新版，避免登录后找不到启动文件或启动旧图。

窗口跟随、按压动画、音效、资源编辑、用量记录、可授权的站点余额等主要能力继续使用上游实现。没有重新编写整个挂件框架。

## 安装与使用（Windows x64）

1. 安装支持本地插件的 Codex 桌面应用。
2. 从 [Releases](https://github.com/BestKittyRosmontis/codex-rosmontis-pet/releases/latest) 下载当前版本的 Windows 完整安装 ZIP，完整解压到一个固定位置。
3. 双击 **`Install.cmd`**。安装器会校验文件、注册并启用本地插件，随后启动挂件。无需管理员权限，发布包已经包含 Electron。
4. 在 Codex 中新开一个会话让插件加载。以后从普通 Codex 入口使用即可；挂件跟随 Codex 窗口，关闭窗口后隐藏。安装器还会注册当前用户登录启动项，让守护进程等待 Codex。

点击挂件会轮换用量气泡、随机台词和关闭气泡；右键打开菜单。`Start.cmd` 可手动恢复，`Stop.cmd` 可暂停，`Uninstall.cmd` 可卸载插件并关闭启动项。手动暂停会被自动启动逻辑尊重，不需要更换 Codex 快捷方式。

如双击安装窗口退出前提示失败，可在解压目录打开 PowerShell 运行下面的命令查看结果：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-dragon-plugin.ps1
```

安装器将程序放在当前用户的本地应用数据目录。商店版 Codex 可能将该目录重定向到 `%LOCALAPPDATA%\Packages\OpenAI.Codex_*\LocalCache\Local\CodexRosmontisPet`；安装回执的 `target` 字段记录实际位置。挂件配置位于 `%USERPROFILE%\.codex\rosmontis-pet`。卸载保留个人配置与历史；这些内容不在分享包中。余额查询需要每位使用者自行配置或授权自己的账户。Token 来自本机可读取的 Codex 记录；估算费用不等于站点实际扣费，缺少数据时不会据此保证余额准确。

## 从源码构建

GitHub 源码不含 Electron 二进制，直接下载“Source code”不能作为完整安装包。Windows x64 下需要 Node.js 24 或更新版本、npm 和 Git：

```powershell
npm ci
npm run check
npm run build:windows
```

构建结果在 `dist/`：带 Electron 的安装 ZIP、SHA-256 校验文件及包内逐文件清单。构建脚本只选取 Git 已跟踪的源码文件；修改或新增源码后先提交或暂存，再构建。

## 许可与验证范围

保留上游 [MIT LICENSE](LICENSE) 和署名。代码许可不自动覆盖角色图片、动图、音效等素材；本仓库不授予额外素材权利。迷迭香为《明日方舟》角色，本仓库不是相关权利方或 OpenAI 的官方项目。

当前发布针对 Windows x64。本次验证包括图片路由、角色名称、48 条台词，以及实际安装后的可见性、无需调用显示工具的 MCP 初始化启动与守护进程复用。未验证 macOS / Linux，也没有重跑上游所有功能测试。Codex 窗口或日志格式更新后可能需要适配。

## 1.0.4 更新

采用已确认的 v5 形象，修正头发、正面衣服方向、银灰印花内搭和细交叉带；保持互动与用量功能。启动路径使用文件的实际位置，普通 Windows 启动环境也能访问。已有属于本挂件的旧计划任务会同步到当前版本；新安装仍使用当前用户启动项与 MCP 加载启动。

可在已安装并启用挂件的 Windows 账户中运行下面的检查。它临时注册一个当前用户测试任务，检查结束后移除该测试任务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-windows-startup.ps1
```

DeepSeek 官方余额查询由上游内置功能提供，每位使用者需要通过挂件的 API 设置自行保存自己的密钥。本仓库和安装包不包含个人账户配置。
