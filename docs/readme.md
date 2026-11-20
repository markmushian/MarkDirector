# MarkDirector 文档目录

[返回项目首页](../README.md)

## 项目介绍

| README 语言 | 入口 |
| --- | --- |
| 简体中文 | [README](../README.md) |
| English | [README](./readme/readmeEn.md) |

项目介绍目前提供简体中文与 English 两个版本；应用界面支持 21 种语言，见[多语言支持](../README.md#languages)。

## 使用与开发

- [开发与扩展指南](./development.md)：源码运行、插件扩展、桌面打包和更新发布。
- [Android 说明](../apps/mobile/readme.md)：ARM64 APK、本地运行、设备互联与构建。
- [贡献指南](../CONTRIBUTING.md)与[开发规范](../AGENTS.md)：参与项目的约定。
- [多语言维护说明](../packages/i18n/readme.md)：字典抽取、动态文案、前后端接入和语言回退。
- [多语言回归记录](../packages/i18n/regression.md)：已完成的检查与已知范围。
- [MCP 接入说明](../packages/mcp/README.md)：外部客户端连接与工具能力。

使用问题与建议请通过 [GitHub Issues](https://github.com/markmushian/MarkDirector/issues) 反馈。

## 目录约定

```text
docs/
  readme.md          文档入口
  development.md     开发与扩展指南
  readme/            英文版项目介绍
  screenshots/       产品截图
  images/            项目标识图片
```

更新项目介绍时，以根目录 `README.md` 为准同步 `docs/readme/readmeEn.md`；截图统一放在 `docs/screenshots/`，移动文件时同时更新 Markdown 与 HTML 中的相对链接。

各子包的实现与维护说明保留在对应 `packages/` 目录。
