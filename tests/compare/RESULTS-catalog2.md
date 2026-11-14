# 工具门控 A/B：开启 dsh-tool-gate vs 不开启

- 生成时间：2026-11-14T09:25:48.644Z
- 模型：`opencode-go/deepseek-v4.1-flash`（reasoningEffort: max）
- 实验体：`E:\Project\dsh-plugins\dsh-channel-manager` 的独立副本，每次运行重建；两臂 prompt 完全相同
- 任务：rows、qrbind、provider、toolkit-notes、arch-split；臂：control / gated / gated-root / delegate-only；每个 (任务, 臂) 一次独立进程、独立 DSH_HOME 与会话库

## 结论摘要

- 完成：control 5/5，gated 5/5，gated-root 5/5，delegate-only 5/5
- **gated**（对 control 的比值）：合计 token 0.64×（859103），未命中缓存输入 0.99×（206403），缓存读 0.56×（613376），首请求工具面 5 个 / 4512 B，平均耗时 99169 ms，select_tools 7 次，delegate 5 次，subagent 0 次，子代理 5 个
- **gated-root**（对 control 的比值）：合计 token 0.59×（796238），未命中缓存输入 1.2×（249349），缓存读 0.46×（507648），首请求工具面 5 个 / 4512 B，平均耗时 110914 ms，select_tools 6 次，delegate 5 次，subagent 0 次，子代理 5 个
- **delegate-only**（对 control 的比值）：合计 token 0.38×（510512），未命中缓存输入 0.61×（126944），缓存读 0.32×（352896），首请求工具面 5 个 / 4512 B，平均耗时 106244 ms，select_tools 6 次，delegate 5 次，subagent 0 次，子代理 5 个

## 汇总

| 臂 | 完成/总数 | 合计 token | 未命中缓存输入 | 缓存读 | 输出 | 根代理 token | 子代理 token | 平均根步数 | 平均根工具调用 | 平均子代理步数 | 平均耗时 ms | 首请求工具面 | 工具面字节 | 子代理数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | 5/5 | 1347699 | 208053 | 1097216 | 42430 | 543029 | 804670 | 7.2 | 9.0 | 8.4 | 124101 | 23 | 17796 | 5 |
| gated | 5/5 | 859103 | 206403 | 613376 | 39324 | 409547 | 449556 | 5.8 | 6.2 | 6.8 | 99169 | 5 | 4512 | 5 |
| gated-root | 5/5 | 796238 | 249349 | 507648 | 39241 | 302482 | 493756 | 5.8 | 6.8 | 6.2 | 110914 | 5 | 4512 | 5 |
| delegate-only | 5/5 | 510512 | 126944 | 352896 | 30672 | 272844 | 237668 | 5.8 | 6.6 | 6.2 | 106244 | 5 | 4512 | 5 |

## 逐任务

| 任务 | 臂 | 完成 | 根步数 | 根工具调用 | 子代理数 | 子代理步数 | 合计 token | 未命中输入 | 缓存读 | 输出 | 耗时 ms | 派发方式 | 答案摘要 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rows | control | ✅ | 4 | 3 | 1 | 3 | 50606 | 15655 | 33024 | 1927 | 41069 | subagent | 已派子代理 `patch-inspector` 检查完毕。它的结论原样如下：  ## Inserted loader rows  - `channel-manager → dsh-channel-manager` - `channel-manager-qqbot → dsh-channel-manager/channels/qqbot`  Both inserted rows carry an `id` and a `name`; neither is missing either field, so no ambiguity note is needed.  ## Verification note  Source: `cordis.patch.yml` in the project directory, top-level key `insert` (line 13) — the fi… |
| rows | gated | ✅ | 4 | 3 | 1 | 4 | 31794 | 9161 | 19968 | 2665 | 45897 | delegate | 子代理已完成。以下是它的结论（原样汇报）：  **结果 — 2 条插入的 row：**  - `channel-manager` -> `dsh-channel-manager` - `channel-manager-qqbot` -> `dsh-channel-manager/channels/qqbot`  **确切的区段与键：** 该 patch 文档是一个 YAML *序列*，其中唯一的项是一个映射，映射中唯一的键是顶层（第 13 行：`- insert:`）的 **`insert`**。它的值是一个包含 2 个元素的 loader row 序列（缩进 4）。此文件中**没有** `loader-rows` / `loaderRows` 键（已用 grep 验证——零匹配）；`insert` 就是该文件自身头部注释所描述的插入区段（“将该包列在 profile 的 `dsh.pro… |
| rows | gated-root | ✅ | 4 | 3 | 1 | 3 | 26791 | 8628 | 16128 | 2035 | 43508 | delegate | 已派子代理（agent-1）查看完毕。以下是它的结论原样转述：  **插入的 loader row 共 2 条：**  ``` channel-manager → dsh-channel-manager channel-manager-qqbot → dsh-channel-manager/channels/qqbot ```  **判定依据（子代理原话要点）：** 整个文件是单个 YAML 序列条目，唯一键为 `insert:`（第 13 行）；其下嵌套的就是本 patch 插入的 loader row 列表，每项带 `id` 字段和一个 `name` 字段（即该行挂载的包名）。文件里没有其它 patch 键（无 `remove`、`replace`、`patch` 等），`insert:` 列表之外也没有别的 row；第 1–12 行仅为注释，17–27、32–42 行为注释/`con… |
| rows | delegate-only | ✅ | 3 | 3 | 1 | 3 | 23427 | 6626 | 14976 | 1825 | 37633 | delegate | 子代理已完成核查。以下是它给出的结论文本，原样转述：  ## 结论  该 `cordis.patch.yml` 只有一个顶层补丁条目 `- insert:`（第 13 行），其下是 loader rows 的列表，没有 `delete`/`replace` 或上下文（context）段落。`insert` 列表中恰好有两条 row：  ``` channel-manager → dsh-channel-manager channel-manager-qqbot → dsh-channel-manager/channels/qqbot ```  共插入 2 条 loader row。  （补充说明：第一条 `channel-manager` 的 `config` 为空对象 `{}`，其后均为注释示例；第二条 `channel-manager-qqbot` 的 `config` 含 `sand… |
| qrbind | control | ✅ | 3 | 2 | 1 | 7 | 214142 | 44237 | 165632 | 4273 | 56741 | subagent | 子代理调查完成，结论原样汇报如下：  - 文件相对路径：`lib/qq-bind.js` - 导出的创建绑定器函数名：`createQrBinder` - 绑定超时：600000 毫秒（即 10 分钟）（定义位置：`lib/qq-bind.js:23`，常量/字段名：`BIND_TIMEOUT_MS`） - 证据：   - `lib/qq-bind.js:22-23`     ```js     /** 扫码绑定默认总超时（毫秒）：超时后二维码作废，状态转 failed。 */     export const BIND_TIMEOUT_MS = 10 * 60 * 1000     ```   - `lib/qq-bind.js:68-77`（唯一创建入口，导出名与 `timeoutMs` 选项）     ```js     export function createQrBinder(… |
| qrbind | gated | ✅ | 4 | 3 | 1 | 7 | 115552 | 24236 | 86656 | 4660 | 62665 | delegate | 子代理已返回结论，以下原样汇报：  ## 结论  - **相对路径**: `lib/qq-bind.js` - **导出函数名**: `createQrBinder`（**命名导出**，非默认导出；文件同时命名导出常量 `BIND_TIMEOUT_MS` 和函数 `renderBindQr`） - **绑定超时**: **600000 ms = 10 分钟**（`10 * 60 * 1000`），常量名 **`BIND_TIMEOUT_MS`**，位于 `lib/qq-bind.js` **第 23 行**；binder 选项字段名为 `timeoutMs`（默认取该常量，第 73 行），provider 侧可配置字段为 `bindTimeoutMs`（默认回退 `BIND_TIMEOUT_MS`）  ### 证据 1：源文件与超时常量（`lib/qq-bind.js`）  ```js 2… |
| qrbind | gated-root | ✅ | 4 | 3 | 1 | 6 | 96853 | 20381 | 72704 | 3768 | 57569 | delegate | 子代理已完成调查，以下为结论原文：  > ## 结论 > > - 文件路径: `lib/qq-bind.js` > - 导出函数: `createQrBinder` > - 绑定超时: **600000 毫秒（= 10 分钟）**（来源: `BIND_TIMEOUT_MS`，可被 provider 配置项 `bindTimeoutMs` 覆盖） > > ## 关键证据行 > > **1. 超时常量定义（默认 10 分钟 = 600000 ms）** > ``` > lib/qq-bind.js:22  /** 扫码绑定默认总超时（毫秒）：超时后二维码作废，状态转 failed。 */ > lib/qq-bind.js:23  export const BIND_TIMEOUT_MS = 10 * 60 * 1000 > ``` > > **2. 工厂函数导出** > ``` > lib/q… |
| qrbind | delegate-only | ✅ | 4 | 3 | 1 | 7 | 65011 | 17101 | 44160 | 3750 | 135249 | delegate | 子代理已经完成查找，以下是它给出的结论（原样汇报）：  ---  三点都已通过实际读取代码确认。文件 `lib/qq-bind.js` 共 283 行，模块注释明确写着「QQ 机器人「扫码绑定」状态机（Host 侧）」；该文件导入了 `./qr.js` 来生成 SVG，并且 `lib/channels/qqbot.js` 把它用作默认绑定器。  - **相对路径**：`lib/qq-bind.js` - **导出函数名**：`createQrBinder` - **绑定超时**：600000 毫秒，即 10 分钟，表达式为 `10 * 60 * 1000`（位置：`lib/qq-bind.js:23`，常量 `BIND_TIMEOUT_MS`）  依据： - `lib/qq-bind.js:2` — `* QQ 机器人「扫码绑定」状态机（Host 侧）。`（模块用途即 QQ 扫码绑定） -… |
| provider | control | ✅ | 4 | 4 | 1 | 3 | 79061 | 29597 | 45312 | 4152 | 70025 | subagent | 子代理 `arch-lookup` 已完成查阅，以下是我的汇报，内容为它的结论原文：  > **① 注册函数名：`registerProvider(provider)`，是 `ChannelManager` 实例（manager）上的方法，不是模块级导出函数**（§6 L124「`registerProvider(provider)` // → disposer；重复 id 抛错」；§1 L13「manager 暴露 `registerProvider(provider)` 扩展点」）。 > > **② 必须方法：`start()`、`stop()`、`status()`、`send({chatKind, chatId, text, msgId?})`**（§7 L313–L321 全部列出；原文未标 required，只列出处；`bindState/startBind/cancelBin… |
| provider | gated | ✅ | 5 | 5 | 1 | 4 | 66580 | 26878 | 34816 | 4886 | 80787 | delegate | 已派子代理（`agent-1`，只读工具）查到结果，并已核对该文件原文一致。结论原样如下：  **文件**：`E:\Project\dsh-plugins\dsh-tool-gate\tests\compare\.compare-run\runs\catalog2\gated-provider\project\docs\ARCH.md` **第 7 节标题原文**：`## 7. Channel provider 契约（qq-channel 实现）`  **① 把 provider 挂进 manager 的注册函数名**：`registerProvider`  原文依据（第 7 节代码块，第 124 行）： ``` registerProvider(provider)            // → disposer；重复 id 抛错 ``` 第 1 节（第 13 行）也写明： > mana… |
| provider | gated-root | ✅ | 5 | 5 | 1 | 6 | 68348 | 22876 | 38400 | 7072 | 104437 | delegate | 已让子代理（只给了 read/glob/grep）查找完毕。其返回的结论文本**原样**如下：  > ## 结论 > > **① 把 provider 挂进 manager 的注册函数名：`registerProvider(provider)`**（原方法名 `registerProvider`，签名带一个 provider 参数）。 > > 需要说明：第 7 节「Channel provider 契约」**没有划分任何小节**（全文只有 `## 7.` 这一级标题，第 301–331 行内不含 `###` 子标题或 `7.1/7.2` 编号），因此注册函数并不出现在第 7 节内部；第 7 节只给出了 provider 插件的模块导出 `apply(ctx, config)` 与 `inject = ['channelManager']`。`registerProvider` 这个名字明确… |
| provider | delegate-only | ✅ | 5 | 5 | 1 | 5 | 47555 | 16571 | 26880 | 4104 | 73701 | delegate | 子代理已完成查阅。下面原样汇报它的结论：  ---  已读完，两个问题都有明确的原文依据。  ## ① 向 manager 注册 provider 的函数名：`registerProvider(provider)`  原文依据：  - `docs/ARCH.md:124`（`lib/manager.js` 的 `ChannelManager` 类接口）：   > `registerProvider(provider)            // → disposer；重复 id 抛错` - 旁证 `docs/ARCH.md:13`（设计目标 5）：   > “manager 暴露 `registerProvider(provider)` 扩展点；QQ 渠道本身就是通过该接口注册的普通 provider（独立 loader row）。”  注意它会返回一个 disposal 函数（dispo… |
| toolkit-notes | control | ✅ | 16 | 25 | 1 | 19 | 618210 | 55773 | 548992 | 13445 | 212603 | subagent | 完成。子代理已创建该文件，并且它自己先读回核对、随后我也独立复核了一遍。  ## 文件  `docs/TOOLKIT-NOTES.md`（79 行，新建；`docs/` 原有的 `ARCH.md` 未动，仓库内无其它改动）  ## 三件事的答案  **① `cordis.patch.yml` 两条 loader row 的 `id`**  | 行 | `id` | `name` | | --- | --- | --- | | A | `channel-manager` | `dsh-channel-manager` | | B | `channel-manager-qqbot` | `dsh-channel-manager/channels/qqbot` |  **② provider 注册函数签名** — `lib/manager.js:438`  ```js registerProvi… |
| toolkit-notes | gated | ✅ | 10 | 14 | 1 | 10 | 382201 | 92590 | 279552 | 10059 | 153569 | delegate | 已完成。子代理建好了文档，按要求读回核对通过；我也独立读回复核了一遍。  ## 文件 `docs/TOOLKIT-NOTES.md`（80 行，UTF-8，Markdown，无乱码）  ## 三项事实（已与源码逐项核对）  **① `cordis.patch.yml` 的两条 loader row id** - `channel-manager`（name: `dsh-channel-manager`） - `channel-manager-qqbot`（name: `dsh-channel-manager/channels/qqbot`）  **② provider 注册函数签名** `ChannelManager.registerProvider(provider)`，定义于 `lib/manager.js:438`： - 必要字段：`id`（非空字符串）、`start`、`stop`… |
| toolkit-notes | gated-root | ✅ | 8 | 11 | 1 | 10 | 334999 | 84650 | 239616 | 10733 | 157568 | delegate | 已完成。子代理 `agent-1`（工具集被固定为 read/glob/grep/write，无法解锁别的工具）建好文件并回读核对，我也独立复核了一遍。  ## 产出 `docs/TOOLKIT-NOTES.md`（66 行，绝对路径 `…\gated-root-toolkit-notes\project\docs\TOOLKIT-NOTES.md`），仅新建这一个文件，未改动仓库其他内容。  ## 三项结论（均带出处） 1. **两条 loader row 的 id**    - `channel-manager`（Row A，`name: dsh-channel-manager`）— `cordis.patch.yml:14`    - `channel-manager-qqbot`（Row B，`name: dsh-channel-manager/channels/qqbot`）— … |
| toolkit-notes | delegate-only | ✅ | 11 | 15 | 1 | 10 | 231493 | 35863 | 183552 | 12078 | 163223 | delegate | 完成。子代理已新建 `docs/TOOLKIT-NOTES.md`，读回核对通过，我也独立复核了一遍内容。  **文件** `E:\Project\dsh-plugins\dsh-tool-gate\tests\compare\.compare-run\runs\catalog2\delegate-only-toolkit-notes\project\docs\TOOLKIT-NOTES.md`（112 行；`docs/` 下现为 `ARCH.md` + `TOOLKIT-NOTES.md`，未改动其他文件）  **三项内容（我逐条对照源码确认无误）**  1. `cordis.patch.yml` 两条 loader row 的 id：    - `channel-manager`（name `dsh-channel-manager`，第 14–15 行）    - `channel-m… |
| arch-split | control | ✅ | 9 | 11 | 1 | 10 | 385680 | 62791 | 304256 | 18633 | 240068 | subagent | 完成了。子代理 `doc-splitter` 做完后自己读回确认过，我又独立把两个文件完整读了一遍复核。  ## 改动结果  **1. 新建 `docs/PROVIDER.md`（39 行）** - 第 7 节正文整体迁入：`lib/channels/qqbot.js` 入口代码块（`name` / `inject` / `apply`）+ provider 对象代码块 + 原有 8 条实现要点（入站转发、凭据解析顺序、`credentials/reference-updated` 重连、不自动连接、网关参考、消息转文本、分片、禁止命令解析/授权）。 - 五个要点逐字保留，代码块内为：   - `id: 'qqbot'`   - `title: 'QQ 机器人'`   - `async start()` / `async stop()` / `status()` / `async send… |
| arch-split | gated | ✅ | 6 | 6 | 1 | 9 | 262976 | 53538 | 192384 | 17054 | 152928 | delegate | 已完成，两个文件均已由子代理写入并读回核对，我也亲自复核了一遍。  ## 结果  **新建 `docs/PROVIDER.md`（31 行）** - 由 `docs/ARCH.md` 第 7 节完整整理而成，标题为 `# Channel provider 契约`。 - provider 对象的 `id: 'qqbot'`、`title: 'QQ 机器人'` 原样保留。 - `start` / `stop` / `status` / `send` 四个方法及其注释、返回结构完整保留：   - `start()`：凭据解析顺序（credential ref → row config → 环境变量），失败 throw   - `stop()`：断开、幂等   - `status()`：`{ state:'stopped'|'starting'|'connected'|'error', detai… |
| arch-split | gated-root | ✅ | 8 | 12 | 1 | 6 | 269247 | 112814 | 140800 | 15633 | 191488 | delegate | 已完成。子代理 `agent-1` 已按契约改完并通过读回核对，我又独立复读了两个文件确认。  ## 改动  **新建 `docs/PROVIDER.md`**（84 行，9 节） - 注明「整理自 docs/ARCH.md 第 7 节」，并带返回 `ARCH.md` 的链接。 - 完整保留了 provider 对象要点：   - `id: 'qqbot'`   - `title: 'QQ 机器人'`   - `async start()`：凭据三级解析（credentials ref → row config → 环境变量），失败 throw，成功连网关   - `async stop()`：断开、幂等   - `status()`：`{ state:'stopped'|'starting'|'connected'|'error', detail?, error?, connectedA… |
| arch-split | delegate-only | ✅ | 6 | 7 | 1 | 6 | 143026 | 50783 | 83328 | 8915 | 121413 | delegate | 已完成，结论如下。  ## 改动内容  **1. 新建 `docs/PROVIDER.md`（35 行）** - 由 `docs/ARCH.md` 第 7 节整理而成，保留入口模块 `lib/channels/qqbot.js`（`name` / `inject` / `apply` 及 `config` 签名），以及 provider 对象的全部契约要点：   - `id: 'qqbot'`   - `title: 'QQ 机器人'`   - `async start()`（凭据解析顺序、失败 throw、成功连网关）   - `async stop()`（断开，幂等）   - `status()`（`stopped` / `starting` / `connected` / `error` 及 `detail`/`error`/`connectedAt`）   - `async sen… |

## 门控与委派行为（非 control 臂）

| 任务 | 臂 | select_tools | 本轮保留的工具 | delegate 调用（工具清单 / sealed） | 目录快照数 | 工具面增量 | 首请求工具数 | 末请求工具数 | 子代理首工具数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rows | gated | 1 | wait_agent,list_agents,send_message | [read,glob,grep] | 2 | list_agents,send_message,wait_agent | 5 | 8 | 5 |
| rows | gated-root | 1 | wait_agent,list_agents | [read,grep] | 2 | list_agents,wait_agent | 5 | 7 | 4 |
| rows | delegate-only | 1 | wait_agent,list_agents | [read,glob,grep] | 2 | list_agents,wait_agent | 5 | 7 | 5 |
| qrbind | gated | 1 | wait_agent,list_agents | [read,grep,glob] | 2 | list_agents,wait_agent | 5 | 7 | 5 |
| qrbind | gated-root | 1 | wait_agent,list_agents | [grep,glob,read] | 2 | list_agents,wait_agent | 5 | 7 | 5 |
| qrbind | delegate-only | 1 | wait_agent,list_agents | [read,glob,grep] | 2 | list_agents,wait_agent | 5 | 7 | 5 |
| provider | gated | 2 | glob,grep,read ; wait_agent,list_agents,glob,grep | [read,glob,grep] | 3 | glob,grep,list_agents,wait_agent | 5 | 9 | 5 |
| provider | gated-root | 1 | wait_agent,list_agents,job_output,job_list | [read,glob,grep] sealed | 2 | job_list,job_output,list_agents,wait_agent | 5 | 9 | 3 |
| provider | delegate-only | 1 | wait_agent,list_agents | [read,glob,grep] sealed | 2 | list_agents,wait_agent | 5 | 7 | 3 |
| toolkit-notes | gated | 2 | glob,grep ; wait_agent,list_agents | [read,write,edit,glob,grep] | 3 | glob,grep,list_agents,wait_agent | 5 | 7 | 7 |
| toolkit-notes | gated-root | 1 | glob,grep,read,list_agents,wait_agent | [read,glob,grep,write] sealed | 2 | glob,grep,list_agents,wait_agent | 5 | 9 | 4 |
| toolkit-notes | delegate-only | 1 | glob,grep,list_agents,wait_agent | [glob,grep,read,write] | 2 | glob,grep,list_agents,wait_agent | 5 | 9 | 6 |
| arch-split | gated | 1 | wait_agent,list_agents | [read,write,edit] sealed | 2 | list_agents,wait_agent | 5 | 7 | 3 |
| arch-split | gated-root | 2 | glob,grep,subagent,list_agents ; glob,grep,list_agents,subagent,wait_agent | [read,write,edit] sealed | 3 | glob,grep,list_agents,subagent,wait_agent | 5 | 10 | 3 |
| arch-split | delegate-only | 2 | read,write,edit,glob,grep ; wait_agent,list_agents | [read,write,edit,grep] sealed | 3 | glob,grep,list_agents,wait_agent | 5 | 7 | 4 |

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
