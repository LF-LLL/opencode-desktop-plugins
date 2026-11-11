# 工程质量核验

核验日期：2026-11-11。范围：三个插件的源码、测试、包入口、文档和当前工作区；本轮未改活动安装目录、OpenCode 配置或应用文件，未提交或发布。

## 结论

已修复一组有复现和回归覆盖的隐私、异常处理、资源边界及升级降级问题，保留原插件身份、功能分工和手工复制安装方式。当前适合作为**明确标注 experimental 的开源插件接受 review**；不能据此声称通过所有 Desktop 版本、平台或生产级安全认证。

## 核验与修复

| 指标 | 已处理的问题 | 回归依据 |
| --- | --- | --- |
| 隐私 | 替换产品相关测试名称；默认不写诊断，不注册交互测试事件；工具快照不保留输出正文；新增摘要对常见凭据形式脱敏 | 插件测试和 UX lifecycle 测试 |
| 搜索健壮性 | 已取消请求不碰磁盘；IPC 透传取消；遍历时检查取消；失败/取消结果不缓存；卸载后旧扫描不能重新填充缓存 | Navigation 边界测试、真实临时文件系统测试 |
| 资源边界 | 最多四个已完成根索引、15 秒 TTL、150000 文件、50000 目录；初始会话快照等待期间最多缓冲 2048 个事件 | 缓存淘汰/过期、缩小资源阈值、挂起快照回归 |
| 异步正确性 | 捕获搜索发起时的会话和本地/远程状态；忽略已过期会话补搜；同步 API 异常进入 Promise 失败处理；晚到快照不覆盖较新的事件状态 | 会话 scope、离线 API、late snapshot 测试 |
| 文件保存 | 拒绝新增 NUL/不完整 Unicode、网络/设备/NTFS stream 路径；保留编码/BOM/CRLF和既有冲突/体积/符号链接/路径替换保护；成功前 flush | UTF-8/UTF-16 真磁盘回归、路径拒绝测试 |
| 升级兼容 | 缺失基础 API 时不挂接；可选 IPC/菜单/剪贴板/编辑器不可用时禁用对应能力；失效搜索作用域检查回退原查询；保留命名空间 | API 缺失、native fallback、cleanup、独立插件测试 |
| 迁移 | macOS 全宽快捷键采用 Command；Windows 保留 Ctrl；三个包分别小版本更新、保持独立复制运行 | 快捷键逻辑测试和独立复制副本测试；非 Mac GUI 验收 |
| 可维护性 | 集中搜索资源参数；拆出元数据筛选/脱敏等纯函数；增加统一无依赖检查入口和维护规则 | 包入口、语法检查、全量回归、维护文档 |

源码依据：

- [Navigation](../plugins/opencode-plugin-workspace-navigation/gui-experimental.cjs)：`enhanceFileSearch`、`getWorkspaceFileIndex`、`clearWorkspaceIndexes`。
- [UX](../plugins/opencode-plugin-ux-enhancements/gui-experimental.cjs)：`saveLocalText`、`presentationMetadata`、`redactSummary`、`setup`、快照/事件处理。
- [Fiori](../plugins/opencode-plugin-fiori-horizon/gui-experimental.cjs)：`main` 的 opt-in 诊断保护。
- 测试：[Navigation](../plugins/opencode-plugin-workspace-navigation/test.cjs)、[UX](../plugins/opencode-plugin-ux-enhancements/test.cjs)、[Fiori](../plugins/opencode-plugin-fiori-horizon/test.cjs)、[文件系统](../tests/navigation-io.test.cjs)、[生命周期](../tests/ux-lifecycle.test.cjs)。

## 实际验证

- 本机 Node 20.20.2 / Windows：原三套基线通过；新增测试先复现空事件导致的异常，再修复并反复全量通过。
- `npm test`：包入口、CJS 语法、三套插件回归、两个集成测试通过；测试子进程使用 `--unhandled-rejections=strict`。
- 临时 ZIP 解压副本：全量通过。三个插件在不同临时父目录单独复制后，分别通过各自测试；Navigation 的跨插件检查在单独安装时按预期跳过。
- 本轮 diff 空白检查通过；中文和英文 README 没有改动；本地文档/图片路径无失效。
- 当前工作区凭据/内部标识规则筛查无命中；四张 PNG 无文本/EXIF 元数据。规则扫描和肉眼检查不是全面秘密检测保证。
- [CI](../.github/workflows/ci.yml) 已配置 Windows/macOS/Linux × Node 22/24，只读权限、固定官方 action commit、关闭 checkout 凭据保留。配置未在线运行，不记作 CI 已通过。

## 尚未满足的验收与保留限制

1. 本轮没有在真实 Desktop 窗口加载新源码。新版全宽、文件树、编辑、复制/下载/外部编辑器、热重载与语言切换仍需手工验收；既有 Windows 2.2.6 记录不等于本轮新版通过。
2. 文件保存仍是非原子就地写入，检查和写入之间仍可能有外部写入竞争；崩溃、磁盘错误时不能保证回滚。默认不改变成替换文件，以免引入权限、符号链接、文件身份及跨平台语义回归。
3. GUI API 是实验性的，缺失 SDK 导出、IPC 契约变更或 DOM 大改仍可能导致加载失败。能力检查降低风险，不承诺未知未来版本兼容。
4. 主进程文件操作是可信本地插件能力，不是安全沙箱。名称索引包含隐藏/gitignored 文件；目录替换竞争不可能仅靠 `realpath` 检查彻底消除。
5. 每次未缓存扫描独立取消，不共享带调用者取消状态的 Promise；同时发生多次 uncached 搜索仍可能有重复 IO。目录读取已在执行时无法立即中断；不能宣称无成本或硬实时取消。
6. UX 仍包含默认关闭的历史维护探针。它们不在普通启动路径中；启用开发选项仍会模拟交互。保留是为了不在硬化阶段重做 GUI 构建/诊断架构，后续重构应独立回归。
7. 当前初始提交仍含旧测试名称。本轮只改工作区；对外发布前应明确选择 amend 未推送的初始提交，避免仅新增提交却把旧名称留在历史里。

完整验收清单和扩展约束见 [CONTRIBUTING](../CONTRIBUTING.md)，隐私边界见 [SECURITY](../SECURITY.md)，行为变化见 [CHANGELOG](../CHANGELOG.md)。
