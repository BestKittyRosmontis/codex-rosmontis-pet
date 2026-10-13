# 来源与本次部分修改

本仓库是局部改编与分发整理，不是原创桌面挂件框架。各层来源保持以下关系：

| 层次 | 来源 | 本仓库处理 |
| --- | --- | --- |
| 底层挂件 | [MeteorNOX / DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | 保留大量 UI、交互、素材管理与账户/用量实现；当前 vendored 包标记为 0.3.17 |
| Codex 适配 | 上游 For-Codex 分支，原说明署名 [Yang-huai406](https://github.com/Yang-huai406) 为适配协作者 | 沿用 Electron 透明窗口、Windows 跟随、日志与账单对接、安装结构等实现 |
| 白紫 GPT 龙娘分享包 | [rattlesdike / codex-dragon-pet-share v1.0.0](https://github.com/rattlesdike/codex-dragon-pet-share/releases/tag/v1.0.0) | 作为本次直接修改基线；不将分享者的成果归为本仓库原创 |
| 迷迭香局部改编 | [BestKittyRosmontis](https://github.com/BestKittyRosmontis) 维护，使用 Codex 辅助修改 | 替换角色图与 80 条互动台词，隔离插件名与数据目录，修复 PowerShell/MCP 自动启动，整理安装入口与发布包 |

原说明中的 macOS 协作与感谢继续保留。本仓库的当前发布只验证 Windows，不将上游其他平台成果算作本次独立实现。

## 原文存档

以下文件直接取自未修改的 v1.0.0 发布 ZIP，保留原字节。它们记录上游历史，里面的版本、旧图和旧安装方式不代表当前用法：

- [原龙娘说明](docs/upstream/README-CODEX-DRAGON.md)
- [原来源说明](docs/upstream/PROVENANCE.md)
- [原第三方声明](docs/upstream/THIRD_PARTY_NOTICES.md)

`vendor/dsh-whale-widget/` 也保留包内自己的来源说明与许可证。角色与互动相关内容存在本次修改，因此并非整个 vendor 目录均未修改。

## 图片与台词

当前 `assets/rosmontis.png` 为基于角色参考与上游 chibi 风格进行 AI 生成/修改的非官方迷迭香同人图。当前默认图采用已确认的 v5：整理头发，收正身体方向，修正浅领口、细交叉带与银灰印花内搭，并去掉耳机。兼容用的 `gpt-dragon.png`、`DSniang1.png`、`DSniang02.png` 等文件名仍在，默认内容也已替换为这张图；文件名不表示它们仍是原角色。

互动台词是为此挂件改写的短玩笑，包含轻微吐槽和 AI 幻觉自嘲，不是角色原作台词，不作为事实性答复使用。保留的旧图、动图和音效仍按上游素材边界分发，没有因代码 MIT 而扩大授权。

## 许可

[LICENSE](LICENSE) 保持上游 MIT 文本与版权。新增代码与文档按同一代码许可提供；角色、图像与音频不自动取得代码许可。本仓库不声称拥有原框架、原素材或《明日方舟》角色权利。依赖许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
