# 工具门控 A/B：开启 dsh-tool-gate vs 不开启

- 生成时间：2026-11-14T08:15:56.893Z
- 模型：`opencode-go/deepseek-v4.1-flash`（reasoningEffort: max）
- 实验体：`E:\Project\dsh-plugins\dsh-channel-manager` 的独立副本，每次运行重建；两臂 prompt 完全相同
- 任务：toolkit-notes、arch-split；臂：control / gated / gated-root / delegate-only；每个 (任务, 臂) 一次独立进程、独立 DSH_HOME 与会话库

## 结论摘要

- 完成：control 2/2，gated 2/2，gated-root 2/2，delegate-only 2/2
- **gated**（对 control 的比值）：合计 token 0.36×（514786），未命中缓存输入 1.19×（161401），缓存读 0.27×（336256），首请求工具面 6 个 / 4991 B，平均耗时 119898 ms，list/enable 2/3，delegate 2，subagent 0，子代理 2 个
- **gated-root**（对 control 的比值）：合计 token 0.3×（424019），未命中缓存输入 0.77×（104851），缓存读 0.24×（297728），首请求工具面 6 个 / 4991 B，平均耗时 136886 ms，list/enable 2/3，delegate 2，subagent 0，子代理 2 个
- **delegate-only**（对 control 的比值）：合计 token 0.46×（656207），未命中缓存输入 0.85×（115063），缓存读 0.41×（513536），首请求工具面 6 个 / 4991 B，平均耗时 179748 ms，list/enable 3/3，delegate 2，subagent 0，子代理 2 个

## 汇总

| 臂 | 完成/总数 | 合计 token | 未命中缓存输入 | 缓存读 | 输出 | 根代理 token | 子代理 token | 平均根步数 | 平均根工具调用 | 平均子代理步数 | 平均耗时 ms | 首请求工具面 | 工具面字节 | 子代理数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | 2/2 | 1428571 | 136014 | 1250432 | 42125 | 541532 | 887039 | 14.5 | 21.5 | 15.0 | 265519 | 23 | 17796 | 2 |
| gated | 2/2 | 514786 | 161401 | 336256 | 17129 | 279786 | 235000 | 8.0 | 10.5 | 7.0 | 119898 | 6 | 4991 | 2 |
| gated-root | 2/2 | 424019 | 104851 | 297728 | 21440 | 226268 | 197751 | 10.0 | 13.0 | 6.5 | 136886 | 6 | 4991 | 2 |
| delegate-only | 2/2 | 656207 | 115063 | 513536 | 27608 | 362827 | 293380 | 12.5 | 17.0 | 10.5 | 179748 | 6 | 4991 | 2 |

## 逐任务

| 任务 | 臂 | 完成 | 根步数 | 根工具调用 | 子代理数 | 子代理步数 | 合计 token | 未命中输入 | 缓存读 | 输出 | 耗时 ms | 派发方式 | 答案摘要 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| toolkit-notes | control | ✅ | 16 | 28 | 1 | 12 | 525485 | 59677 | 448256 | 17552 | 237067 | subagent | 已经完成，并且我本人再次核对过。  ## 交付物  `docs/TOOLKIT-NOTES.md`（108 行，新建）。它文档化了 `dsh-channel-manager` 的三个要点：  1. **两条 loader row 的 id**：`cordis.patch.yml`    - Row A：`channel-manager`（name `dsh-channel-manager`，第 14–15 行）    - Row B：`channel-manager-qqbot`（name `dsh-channel-manager/channels/qqbot`，第 29–30 行） 2. **provider 注册函数签名**：`lib/manager.js:438`    ```js    registerProvider(provider) => () => void   // 返回… |
| toolkit-notes | gated | ✅ | 9 | 13 | 1 | 9 | 314557 | 74169 | 231168 | 9220 | 133814 | delegate | 已完成。子代理（`agent-1`）新建了 `docs/TOOLKIT-NOTES.md`，并用 read 工具把文件读回逐条核对后汇报；我随后独立复核了文件与三处源码事实，结果一致。  ## 交付物  - 路径：`E:\Project\dsh-plugins\dsh-tool-gate\tests\compare\.compare-run\runs\gated-toolkit-notes\project\docs\TOOLKIT-NOTES.md` - 状态：新建，46 行，非空；子代理称仅创建此一个文件、未改动其它文件。  ## 三件事的答案  | 事项 | 确认值 | 依据 | | --- | --- | --- | | ① 两条 loader row 的 id | `channel-manager`（row A）、`channel-manager-qqbot`（row B） | `… |
| toolkit-notes | gated-root | ✅ | 12 | 18 | 1 | 7 | 251640 | 56542 | 183552 | 11546 | 157415 | delegate | 子代理已完成并汇报，我做了独立复核，全部通过。  ## 结论  **产出文件**：`docs/TOOLKIT-NOTES.md`（58 行，新建；`docs/` 目录下现在只有原有的 `ARCH.md` 和这个新文件）  **三件事均写入且与源码一致**：  | 事 | 内容 | 源码证据（我已亲自核对） | |---|---|---| | ① | 两条 loader row 的 `id`：`channel-manager`（Row A）、`channel-manager-qqbot`（Row B） | `cordis.patch.yml:14`、`:29`，逐字一致 | | ② | `registerProvider(provider)`，定义在 `lib/manager.js:304` 的 `export class ChannelManager` 内；参数 `{ id, title?… |
| toolkit-notes | delegate-only | ✅ | 14 | 20 | 1 | 13 | 294413 | 42854 | 241280 | 10279 | 165015 | delegate | 已完成。我把新建文档的任务交给子代理，子代理写完后读回自检，我又独立复核了一遍。  ## 交付物 `docs/TOOLKIT-NOTES.md`，共 78 行；新建文件，未改动 `docs/ARCH.md`、`README.md` 或任何源码。  ## 子代理执行情况 - 子代理执行时（`agent-1`）只能用 read、write、edit、glob、grep，并且这些工具被封死（sealed），因此无法扩大权限。 - 写完后，它用 read **完整读回文件**，逐项核对；其间做了 2 次修正并再次读回：补回 `onCredentials` 的 JSDoc 续行，改写第一条 row 关于 `config` 的表述。 - 汇报中给出了读回后的实际行号与文本片段作为证据。  ## 我的独立复核（读回文件并对照源码） | 核对项 | 文档内容 | 源码证据 | 结果 | |---|---|… |
| arch-split | control | ✅ | 13 | 15 | 1 | 18 | 903086 | 76337 | 802176 | 24573 | 293971 | subagent | 已完成。这次只有一个子代理 `provider-doc` 负责改写，我作为 lead 在它结束后又独立读回核实了一遍。  ## 改动内容  **新增 `docs/PROVIDER.md`（115 行）**：从 ARCH.md 第 7 节抽出的 provider 契约，10 个小节：  | 小节 | 内容 | |---|---| | 1 | 模块入口（row B）：`name` / `inject` / `apply(ctx, config)` | | 2 | **provider 对象：`id`、`title`、`start` / `stop` / `status` / `send`** | | 3 | 入站消息路由（`manager.handleInbound` + `send` 闭包） | | 4 | 凭据解析顺序（credential ref → row config → 环境变量）… |
| arch-split | gated | ✅ | 7 | 8 | 1 | 5 | 200229 | 87232 | 105088 | 7909 | 105982 | delegate | 已完成，子代理和我都已读回确认。  ## 改动结果  **新建 `docs/PROVIDER.md`（37 行）** - 来源说明：整理自 `docs/ARCH.md` 第 7 节，冲突时以 ARCH.md 为准。 - `## 插件入口`：保留 `name` / `inject` / `apply(ctx, config)` 及 config 形状。 - `## provider 对象`：完整保留 6 个要点 —— `id: 'qqbot'`、`title: 'QQ 机器人'`、`async start()`、`async stop()`、`status()`、`async send({ chatKind, chatId, text, msgId? })`，语义注释未改。 - `## 其余契约要点`：原第 7 节的 8 条要点逐条保留（handleInbound、凭据解析顺序、refere… |
| arch-split | gated-root | ✅ | 8 | 8 | 1 | 6 | 172379 | 48309 | 114176 | 9894 | 116357 | delegate | 子代理已完成，我也做了独立复查，结论无误。  ## 改动结果  **1. 新建 `docs/PROVIDER.md`（74 行）**  内容为第 7 节契约的自包含整理版，结构如下： - 入口模块契约：`name = 'channel-manager-qqbot'`、`inject = ['channelManager']`、`apply(ctx, config)` 及 config 形状 - provider 对象代码块 + 要点表 - 收消息与 `handleInbound` 回调 - 凭据解析顺序与 `credentials/reference-updated` 监听 - 启动语义（不自动连接） - 网关参考与 `sandbox` - QQ 消息转文本规则 - 分片发送规则 - 职责边界（禁止在 provider 内做命令解析/授权）  **2. `docs/ARCH.md` 第 7… |
| arch-split | delegate-only | ✅ | 11 | 14 | 1 | 8 | 361794 | 72209 | 272256 | 17329 | 194481 | delegate | 已完成，并做了双重确认：子代理执行后读回了两个文件；我也独立读回复核了一遍。  ## 子代理执行结果  派出的子代理 `agent-1`（工具面 sealed 为仅 `read/write/edit`）完成了拆分，并按要求读回两个文件自检。  ### 1. 新建 `docs/PROVIDER.md`（44 行）  - **模块入口**（第 12–14 行）：保留 `name = 'channel-manager-qqbot'`、`inject = ['channelManager']`、`apply(ctx, config)` 及 config 注释。 - **provider 对象**（第 21–26 行），五个要点一个不少：   - `id: 'qqbot'`（21 行）   - `title: 'QQ 机器人'`（22 行）   - `start()`（23 行）   - `stop… |

## 门控与委派行为（非 control 臂）

| 任务 | 臂 | list_tools | enable_tools | 请求解锁的工具 | delegate 调用（工具清单 / sealed） | 工具面增量 | 首请求工具数 | 末请求工具数 | 子代理首工具数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| toolkit-notes | gated | 1 | 2 | grep,glob ; wait_agent,list_agents | [read,write,edit,grep,glob] sealed | glob,grep,list_agents,wait_agent | 6 | 10 | 5 |
| toolkit-notes | gated-root | 1 | 2 | glob,grep ; wait_agent | [read,write,glob,grep] sealed | glob,grep,wait_agent | 6 | 9 | 4 |
| toolkit-notes | delegate-only | 2 | 2 | glob,grep ; wait_agent,list_agents | [read,write,edit,glob,grep] sealed | glob,grep,list_agents,wait_agent | 6 | 10 | 5 |
| arch-split | gated | 1 | 1 | wait_agent,list_agents | [read,write,edit] sealed | list_agents,wait_agent | 6 | 8 | 3 |
| arch-split | gated-root | 1 | 1 | wait_agent | [read,write,edit] sealed | wait_agent | 6 | 7 | 3 |
| arch-split | delegate-only | 1 | 1 | wait_agent,list_agents | [read,write,edit] sealed | list_agents,wait_agent | 6 | 8 | 3 |

## 读数说明

- 所有 token 数字来自 provider 在 `assistant/message.usage` 回报的计数，不是估算；`未命中缓存输入`、`缓存读`、`缓存写` 三者相加 = 计费输入，再加 `输出` = 合计 token。
- **为什么把缓存读单列**：工具 schema 在每一步都作为前缀重发，命中缓存后按缓存价计（各家折扣不同）。门控省下的是"重复上下文体积"，看 `未命中缓存输入` 才知道首次处理量的真实变化。
- `首请求工具面` 取自根代理第一次 `request/header` 事件的 `tools` 数组（工具数与 UTF-8 字节数）；每步都会重发这个固定前缀，所以工具面差会随步数放大。
- `工具面增量` 是会话里 `developer/message` 的 `tool-addition` 块：模型解锁工具后，agent loop 自动写下的"你的工具变了"的增量声明。
- 完成度：简单任务看根代理最终回答文本是否包含必须出现的事实；`toolkit-notes` / `arch-split` 这类复杂任务直接读运行后的工作区（产物文件是否存在、关键事实是否齐全、原文件是否被正确改动），不看模型自述。
- 两臂都不挂 shell（`tool-pwsh` / `tool-bash` 已禁用）：任务是文件读写，且本机 pwsh 自身报 Win32 ACL 失败，留着会让两臂因环境缺陷而非门控差异失分。
- `gated` / `delegate-only` 臂的子代理同样被门控；`gated-root` 臂只门控根代理（子代理拿完整工具面），三个臂放在一起就能把"父代理更克制"和"子代理上下文更小"两个因素拆开。
- 每个 (任务, 臂) 只跑一次；模型有采样噪声，差 10% 以内不要当成结论。
- 逐次原始数据在 `RESULTS.json`，每次运行的完整 stdout/stderr 在该次 `runDir/run.log`。
