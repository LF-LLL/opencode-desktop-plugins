# Third-party notices

[中文](THIRD-PARTY-NOTICES.zh.md) · [Project home](README.md)

## Horizon color references

The Fiori plugin uses selected color and theme values from **@sap-theming/theming-base-content 11.36.5**, published by **SAP SE** under **Apache-2.0**.

- [Upstream project](https://github.com/SAP/theming-base-content)
- [Package metadata](https://unpkg.com/@sap-theming/theming-base-content@11.36.5/package.json)
- [Horizon values](https://unpkg.com/@sap-theming/theming-base-content@11.36.5/content/Base/baseLib/sap_horizon/variables.json)
- [Included license](LICENSES/Apache-2.0.txt)

This project does not redistribute the full theme package. The component assignments, CSS rules, and pale categorical tints are a modified adaptation for OpenCode, not SAP's original theme implementation. Keep this notice and the Apache license when redistributing the plugin.

## Runtime host

The source imports SDK modules supplied by OpenCode Desktop, plus Electron and Node built-ins. The GUI host supplies Effect and Solid modules. This repository does not bundle OpenCode, those libraries, or their source. Their own licenses apply to their respective projects.

## Names and endorsement

SAP and SAP Fiori are names or trademarks of SAP SE. OpenCode identifies the host application. These names are used descriptively. This project is not affiliated with, endorsed by, or supported by SAP SE or the OpenCode maintainers.

The project's own code and documentation use [MIT](LICENSE). Third-party material keeps its original license.
