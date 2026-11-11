# 第三方说明

[English](THIRD-PARTY-NOTICES.md) · [项目首页](README.zh.md)

## Horizon 配色参考

Fiori 插件使用 **SAP SE** 发布的 **@sap-theming/theming-base-content 11.36.5** 中部分颜色和主题参数，上游许可为 **Apache-2.0**。

- [上游项目](https://github.com/SAP/theming-base-content)
- [包元数据](https://unpkg.com/@sap-theming/theming-base-content@11.36.5/package.json)
- [Horizon 参数](https://unpkg.com/@sap-theming/theming-base-content@11.36.5/content/Base/baseLib/sap_horizon/variables.json)
- [附带许可原文](LICENSES/Apache-2.0.txt)

本项目不分发完整主题包。组件分配、CSS 规则和淡色分类底色是针对 OpenCode 修改后的适配，不是 SAP 原主题实现。再次分发插件时请保留这份说明和 Apache 许可。

## 运行宿主

源码使用 OpenCode Desktop 提供的 SDK，以及 Electron 和 Node 内置模块。GUI 宿主提供 Effect 和 Solid 模块。本仓不捆绑 OpenCode、这些库或它们的源码，各项目仍适用自身许可。

## 名称与背书

SAP、SAP Fiori 是 SAP SE 的名称或商标，OpenCode 用于说明运行平台。本项目仅作描述性使用，与 SAP SE 和 OpenCode 维护团队无隶属关系，未获其背书或支持。

本项目自身的代码和文档采用 [MIT](LICENSE)，第三方内容仍保留原许可。英文许可原文不作法律翻译。
