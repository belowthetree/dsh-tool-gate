# 工具门控 A/B：开启 dsh-tool-gate vs 不开启

- 生成时间：2026-11-14T09:03:37.245Z
- 模型：`opencode-go/deepseek-v4.1-flash`（reasoningEffort: max）
- 实验体：`E:\Project\dsh-plugins\dsh-channel-manager` 的独立副本，每次运行重建；两臂 prompt 完全相同
- 任务：rows、qrbind、provider、toolkit-notes、arch-split；臂：control / gated / gated-root / delegate-only；每个 (任务, 臂) 一次独立进程、独立 DSH_HOME 与会话库

## 结论摘要

- 完成：control 5/5，gated 5/5，gated-root 5/5，delegate-only 5/5
- **gated**（对 control 的比值）：合计 token 0.42×（770363），未命中缓存输入 0.84×（208254），缓存读 0.34×（530048），首请求工具面 5 个 / 4512 B，平均耗时 98440 ms，select_tools 10 次，delegate 5 次，subagent 0 次，子代理 5 个
- **gated-root**（对 control 的比值）：合计 token 0.45×（830354），未命中缓存输入 0.8×（196731），缓存读 0.39×（601856），首请求工具面 5 个 / 4512 B，平均耗时 99631 ms，select_tools 8 次，delegate 5 次，subagent 1 次，子代理 5 个
- **delegate-only**（对 control 的比值）：合计 token 0.33×（617339），未命中缓存输入 0.55×（137028），缓存读 0.29×（455552），首请求工具面 5 个 / 4512 B，平均耗时 82482 ms，select_tools 9 次，delegate 10 次，subagent 0 次，子代理 8 个

## 汇总

| 臂 | 完成/总数 | 合计 token | 未命中缓存输入 | 缓存读 | 输出 | 根代理 token | 子代理 token | 平均根步数 | 平均根工具调用 | 平均子代理步数 | 平均耗时 ms | 首请求工具面 | 工具面字节 | 子代理数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | 5/5 | 1849044 | 247369 | 1554304 | 47371 | 613041 | 1236003 | 7.0 | 10.2 | 9.0 | 121939 | 23 | 17796 | 5 |
| gated | 5/5 | 770363 | 208254 | 530048 | 32061 | 447582 | 322781 | 6.8 | 7.4 | 5.8 | 98440 | 5 | 4512 | 5 |
| gated-root | 5/5 | 830354 | 196731 | 601856 | 31767 | 240595 | 589759 | 5.6 | 6.0 | 7.0 | 99631 | 5 | 4512 | 5 |
| delegate-only | 5/5 | 617339 | 137028 | 455552 | 24759 | 317002 | 300337 | 6.4 | 6.8 | 4.0 | 82482 | 5 | 4512 | 8 |

## 逐任务

| 任务 | 臂 | 完成 | 根步数 | 根工具调用 | 子代理数 | 子代理步数 | 合计 token | 未命中输入 | 缓存读 | 输出 | 耗时 ms | 派发方式 | 答案摘要 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rows | control | ✅ | 5 | 5 | 1 | 2 | 52100 | 16430 | 32768 | 2902 | 48947 | subagent | 子代理 `patch-inspector` 的结论原文如下（我另外核对了源文件，与其结论一致）：  > ## File > `E:\Project\dsh-plugins\dsh-tool-gate\tests\compare\.compare-run\runs\control-rows\project\cordis.patch.yml` (42 lines total; not modified) > > ## Inserted loader rows (`id → name`) > > ``` > channel-manager → dsh-channel-manager > channel-manager-qqbot → dsh-channel-manager/channels/qqbot > ``` > > ## Supporting lines > > The file cont… |
| rows | gated | ✅ | 5 | 4 | 1 | 2 | 28490 | 11120 | 15872 | 1498 | 33602 | delegate | 子代理（agent-1）的结论原文如下：  ``` channel-manager → dsh-channel-manager channel-manager-qqbot → dsh-channel-manager/channels/qqbot  Note: read `E:\Project\dsh-plugins\dsh-tool-gate\tests\compare\.compare-run\runs\gated-rows\project\cordis.patch.yml`; total inserted rows found: 2 (both under the single `- insert:` block at line 13). ```  （我随后亲自核对了该文件第 13–30 行，两条插入行与上述结论一致。） |
| rows | gated-root | ✅ | 5 | 5 | 1 | 2 | 36040 | 15176 | 19584 | 1280 | 29672 | subagent | 子代理已查完，结论原样汇报如下：  ---  共 1 个 `insert:` 块，其中包含 2 条 loader row：  - `channel-manager` → `dsh-channel-manager` - `channel-manager-qqbot` → `dsh-channel-manager/channels/qqbot`  说明：其余内容均为注释，包括 config 中关于 takeover、turnNotify 等字段的示例说明，以及顶层注释中提到的 “Row A”、“Row B”；注释中的示例文字不是校验值。 |
| rows | delegate-only | ✅ | 4 | 3 | 1 | 2 | 22032 | 8037 | 12416 | 1579 | 31733 | delegate | 已派子代理（agent-1）查阅 `cordis.patch.yml`，其结论原样汇报如下：  ---  我直接读取了该文件（共 42 行）。文件只包含一个顶层 `- insert:` 操作（第 13 行），其下条目即下面两条 loader row；每行的 `id`/`name` 都是行内纯标量（文件中无引号）。  **插入的 row（id → name）：** ``` channel-manager → dsh-channel-manager channel-manager-qqbot → dsh-channel-manager/channels/qqbot ```  **行号 / 依据：** - Row 1 —— `id: channel-manager` 在第 14 行，`name: dsh-channel-manager` 在第 15 行（后接第 16 行 `config: {}`… |
| qrbind | control | ✅ | 4 | 4 | 1 | 14 | 500912 | 61481 | 434432 | 4999 | 73263 | subagent | 子代理 **qr-bind-scout** 的结论原文如下：  - 路径: lib/qq-bind.js - 函数名: createQrBinder - 超时: 600000 毫秒（即 10 分钟）（来源: lib/qq-bind.js:23 的 `BIND_TIMEOUT_MS`，默认参数 timeoutMs 在 lib/qq-bind.js:73）  关键证据： - `lib/qq-bind.js:23`: `export const BIND_TIMEOUT_MS = 10 * 60 * 1000` - `lib/qq-bind.js:68`: `export function createQrBinder(options = {})`（命名导出，非默认导出） - `lib/qq-bind.js:73,179`: `timeoutMs = BIND_TIMEOUT_MS`；`setT… |
| qrbind | gated | ✅ | 4 | 3 | 1 | 7 | 109669 | 26225 | 79616 | 3828 | 64057 | delegate | 子代理已完成核查，结论原文如下：  - 文件路径：`lib/qq-bind.js` - 导出函数名：`createQrBinder`（具名导出 `export function createQrBinder(options = {})`，该文件没有默认导出；同一文件里另外两个导出是常量 `BIND_TIMEOUT_MS` 和函数 `renderBindQr`） - 绑定超时：600000 毫秒（即 10 分钟）（见 `lib/qq-bind.js:23`，`export const BIND_TIMEOUT_MS = 10 * 60 * 1000`）  证据与排除过程：  - `lib/qq-bind.js:23` 定义了默认总超时 `BIND_TIMEOUT_MS = 10 * 60 * 1000`；在 `createQrBinder` 中，该值作为 `timeoutMs` 的默认值（`… |
| qrbind | gated-root | ✅ | 4 | 3 | 1 | 5 | 77986 | 25186 | 49664 | 3136 | 54458 | delegate | 子代理已完成调查（只读，未改动任何文件）。以下把它的结论原样汇报如下：  ## 结论  **1. 实现文件（相对仓库根目录）** ``` lib/qq-bind.js ``` 即「扫码绑定状态机（Host 侧）」主实现；`lib/channels/qqbot.js` 是调用方（provider 注入 SDK 的 `startQrConnect`）。  **2. 创建绑定器的工厂函数名** 具名导出（named export）`createQrBinder`，**没有默认导出**（`export default`）：  ```js // lib/qq-bind.js:68 export function createQrBinder(options = {}) { ... } // lib/qq-bind.js:282 return { state: wireState, start, ca… |
| qrbind | delegate-only | ✅ | 6 | 5 | 1 | 5 | 78291 | 22362 | 52352 | 3577 | 71606 | delegate | 我派出的子代理已经完成核实，下面原样汇报它的结论：  ---  ## 结论  **1. 实现文件相对路径（相对仓库根目录）**  ``` lib/qq-bind.js ```  依据：该文件第 2 行的文档注释写明：`QQ 机器人「扫码绑定」状态机（Host 侧）`；`docs/ARCH.md` 第 65 行将其登记为「扫码自动绑定状态机（官方 SDK 回调 → 可轮询状态）+ 二维码 SVG 渲染」。`lib/channels/qqbot.js` 第 38 行 `import { BIND_TIMEOUT_MS, createQrBinder } from '../qq-bind.js'` 也指向它。  **2. 导出的「创建绑定器」函数名**  ``` createQrBinder ```  依据：`lib/qq-bind.js` 第 68 行 `export function cre… |
| provider | control | ✅ | 5 | 5 | 1 | 7 | 139169 | 30687 | 101760 | 6722 | 107782 | subagent | 子代理 `arch-reader` 已返回，结论原文如下：  > 【注册函数】registerProvider > > 【必须方法】start、stop、status、send > > 【原文依据】 > - 第 301 行，即第 7 节的标题（原文为）：`## 7. Channel provider 契约（qq-channel 实现）` > - 第 314–320 行，§7「provider 对象：」代码块中列出的方法签名原文：`async start()          // 解析凭据（credential ref → row config → 环境变量），失败 throw Error('...'), 成功连接网关`；`async stop()           // 断开，幂等`；`status()               // { state:'stopped'|'start… |
| provider | gated | ✅ | 5 | 6 | 1 | 5 | 61737 | 22931 | 34432 | 4374 | 75475 | delegate | 已派子代理查完（sealed 子代理，仅 `read`/`glob`/`grep`），并用 `read` 复核了引用行号，与子代理结论一致。原样汇报：  ## 定位  - 文件：`docs/ARCH.md`（425 行） - 第 7 节标题：`## 7. Channel provider 契约（qq-channel 实现）` - 第 7 节起止行号：**301 – 331 行**（301 行是标题，331 行是该节最后一条要点；333 行起为 `## 8. Web API`）  ## ① 注册函数名  **`registerProvider(provider)`**  但需如实说明：**第 7 节本身没有写出注册函数名**（该节只描述 provider 对象形状与行为约定）。函数名出现在同一文档的 §1 与 §6：  > 第 13 行：`5. **可扩展渠道**：manager 暴露 \`… |
| provider | gated-root | ✅ | 4 | 5 | 1 | 6 | 52423 | 18248 | 29440 | 4735 | 78875 | delegate | 已派出子代理查阅，并由我本人复核原文（`docs/ARCH.md`，共 425 行）。结论原样汇报如下：  **文档定位**：第 7 节标题在第 301 行 —— `## 7. Channel provider 契约（qq-channel 实现）`，内容至第 331 行（第 333 行起是第 8 节）。  ---  **① 注册函数名：`registerProvider(provider)`**  需要更正的一点：这个函数名**并不在第 7 节里**，第 7 节只描述 provider 对象形状与实现要求。它出现在**第 6 节「Manager 契约」第 124 行**（第 1 节第 13 行也有对应表述）：  > `registerProvider(provider)            // → disposer；重复 id 抛错`  签名即 `registerProvider(pr… |
| provider | delegate-only | ✅ | 4 | 3 | 1 | 5 | 32201 | 9890 | 20096 | 2215 | 44188 | delegate | 子代理已完成查证，以下是它的结论（原样转述）：  ---  函数名：`registerProvider`（调用形式为 `registerProvider(provider)`）  必须提供的方法：`start()`、`stop()`、`status()`、`send({ chatKind, chatId, text, msgId? })`。这些方法都应提供，其中 `send` 是异步的。  原文依据：`docs/ARCH.md:124` `  registerProvider(provider)            // → disposer；重复 id 抛错` （同一函数的另一处说明见 `docs/ARCH.md:13`：「manager 暴露 `registerProvider(provider)` 扩展点」）  provider 端的方法原文见 `docs/ARCH.md:313-… |
| toolkit-notes | control | ✅ | 14 | 27 | 1 | 7 | 591833 | 79640 | 497536 | 14657 | 144226 | subagent | 完成。子代理 `toolkit-notes-writer` 已新建并读回核对 `docs/TOOLKIT-NOTES.md`；我也独立复核了文件与源码，三项事实全部正确，未发现行号错位，未改动任何源码或其他文档。  文件：`docs/TOOLKIT-NOTES.md`（120 行，中文 Markdown，每项均标注源码文件与行号）  三项结论：  1. **两条 loader row 的 id**（`cordis.patch.yml:14,29`）    - Row A：`channel-manager`（name `dsh-channel-manager`）    - Row B：`channel-manager-qqbot`（name `dsh-channel-manager/channels/qqbot`）  2. **provider 注册函数签名**（`lib/manager.j… |
| toolkit-notes | gated | ✅ | 10 | 14 | 1 | 7 | 300293 | 95220 | 195200 | 9873 | 152089 | delegate | 已完成。子代理已按要求创建文件、读回核对并汇报；我又独立读了一遍成品并抽查了源码行号，均无误。  ## 交付物  `docs/TOOLKIT-NOTES.md`（100 行，仓库根下新文件；未改动其他文件）  ## 三项内容  **① `cordis.patch.yml` 中两条 loader row 的 id**（`- insert:` 在第 13 行） - Row A：`channel-manager`（第 14 行） - Row B：`channel-manager-qqbot`（第 29 行）  **② provider 注册函数签名**（`lib/manager.js`，`ChannelManager` 类第 304 行）  ```js registerProvider(provider)  // 第 438 行，返回 () => void（幂等 disposer） ```  `… |
| toolkit-notes | gated-root | ✅ | 10 | 11 | 1 | 13 | 407597 | 69417 | 326400 | 11780 | 183737 | delegate | 子代理已完成，并且我作为根 agent 也独立复核过：文件确实存在、内容与源码一致。  ## 交付物 `docs/TOOLKIT-NOTES.md`（113 行）— 由子代理新建，只创建了这一个文件，未改动其它文件。文档含 5 个小节，三个要点均附来源路径、行号和原样片段。  ## 三个结论（已由我独立比对源码确认）  **① `cordis.patch.yml` 两条 loader row 的 id** - `channel-manager`（第 14–16 行，name: `dsh-channel-manager`） - `channel-manager-qqbot`（第 29–33 行，name: `dsh-channel-manager/channels/qqbot`）  **② provider 注册函数签名** - `lib/manager.js:438`，`class Cha… |
| toolkit-notes | delegate-only | ✅ | 7 | 10 | 1 | 12 | 241296 | 41899 | 189696 | 9701 | 143769 | delegate | 已完成。子代理新建了 `docs/TOOLKIT-NOTES.md`（151 行），写完后完整回读核对；我作为主代理又独立抽查了关键源码，结果一致。  ## 交付物  `docs/TOOLKIT-NOTES.md` — 记录三项工具链标识符，每项均标注源码文件与行号，末尾附速查表。  ## 三项结论  **① `cordis.patch.yml` 两条 loader row 的 id**  | 行 | 位置 | id | name | |---|---|---|---| | Row A | `cordis.patch.yml:14` | `channel-manager` | `dsh-channel-manager` | | Row B | `cordis.patch.yml:29` | `channel-manager-qqbot` | `dsh-channel-manager/cha… |
| arch-split | control | ✅ | 7 | 10 | 1 | 15 | 565030 | 59131 | 487808 | 18091 | 235478 | subagent | 已完成，子代理 `provider-doc` 负责执行，我已复核它的产出。  ## 改动  **新增 `docs/PROVIDER.md`（130 行）**，这是把 `docs/ARCH.md` 第 7 节的 provider 契约整理成的独立文档：  - `# Channel provider 契约` 开头说明它是 ARCH 第 7 节的展开，适用实现是 `lib/channels/qqbot.js`（qq-channel owner）。 - §1 Provider 入口：`name`、`inject = ['channelManager']`、`apply(ctx, config)`。 - §2 provider 对象：代码块加 2.1–2.5 五个小节逐项说明   - `id: 'qqbot'`、`title: 'QQ 机器人'`（字段，用于寻址与展示）   - `start()`：… |
| arch-split | gated | ✅ | 10 | 10 | 1 | 8 | 270174 | 52758 | 204928 | 12488 | 166975 | delegate | 任务已完成。子代理按约定创建并修改了文件，随后用 `read` 工具读回两个文件进行核对；我也独立复核了一遍。  ## 改了什么  **① 新建 `docs/PROVIDER.md`（46 行）** - `# Channel provider 契约（provider 接口）`，标题下注明整理自 `docs/ARCH.md` 第 7 节。 - 完整保留 provider 对象的六个要点（原样 JS 块 + 逐条语义说明）：   - `id: 'qqbot'`、`title: 'QQ 机器人'`   - `async start()`（按 credentials 服务 → row config → 环境变量解析凭据，失败抛出错误，成功连接网关）   - `async stop()`（断开连接，幂等）   - `status()`（返回 `stopped|starting|connected|e… |
| arch-split | gated-root | ✅ | 5 | 6 | 1 | 9 | 256308 | 68704 | 176768 | 10836 | 151414 | delegate | 复核通过，两处改动都符合预期。  ## 完成情况  **执行方式**：按你的要求派了子代理 `agent-1`（工具仅 `read/write/edit`）完成改动，root 未直接编辑文件；子代理改完后读回两个文件逐项核对，我又独立复读了一遍。  **1. 新建 `docs/PROVIDER.md`（90 行）** - 标题「Channel provider 契约」，开头链接回 `ARCH.md`，并注明以 ARCH 原文为准。 - provider 对象六个要点全部保留且语义未变：`id: 'qqbot'`、`title: 'QQ 机器人'`、`async start()`（凭据解析顺序 credential ref → row config → 环境变量，失败 throw、成功连网关）、`async stop()`（断开、幂等）、`status()`（返回 `{ state:'sto… |
| arch-split | delegate-only | ✅ | 11 | 13 | 4 | 8 | 243519 | 54840 | 180992 | 7687 | 121114 | delegate | 改完了，两个文件我都亲自读回核对过。  ## 执行方式  按你的要求，我把活派给了一个子代理，只给它 `read` / `write` / `edit` 三个工具，明确要求它：整理 `docs/ARCH.md` 第 7 节 → 新建 `docs/PROVIDER.md` → 在 ARCH 第 7 节开头插链接 → 自己读回两个文件自检后汇报。  ## 改动结果  **新增 `docs/PROVIDER.md`（33 行）** - 开头：一级标题 + 一行说明「本文件自 `ARCH.md` 第 7 节抽出，原文以其为准。」 - 五个要点逐字保留，签名和行内注释都没丢：  ```js {   id: 'qqbot',   title: 'QQ 机器人',   async start()          // 解析凭据（credential ref → row config → 环境变量），失… |

## 门控与委派行为（非 control 臂）

| 任务 | 臂 | select_tools | 本轮保留的工具 | delegate 调用（工具清单 / sealed） | 目录快照数 | 工具面增量 | 首请求工具数 | 末请求工具数 | 子代理首工具数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rows | gated | 1 | wait_agent,list_agents | [read,grep,glob] | 0 | list_agents,wait_agent | 5 | 7 | 5 |
| rows | gated-root | 2 | subagent,glob,grep,read,list_agents ; subagent,glob,grep,read,list_agents,wait_agent | — | 0 | glob,grep,list_agents,subagent,wait_agent | 5 | 10 | 5 |
| rows | delegate-only | 1 | wait_agent,list_agents | [read,glob,grep] | 0 | list_agents,wait_agent | 5 | 7 | 5 |
| qrbind | gated | 1 | wait_agent,list_agents,send_message | [read,grep,glob] | 0 | list_agents,send_message,wait_agent | 5 | 8 | 5 |
| qrbind | gated-root | 1 | wait_agent,list_agents,send_message | [read,glob,grep] | 0 | list_agents,send_message,wait_agent | 5 | 8 | 5 |
| qrbind | delegate-only | 1 | wait_agent,list_agents | [read,grep,glob,bash] ; [read,grep,glob,pwsh] ; [read,grep,glob] | 0 | list_agents,wait_agent | 5 | 7 | 5 |
| provider | gated | 1 | wait_agent,list_agents,read,glob,grep | [read,glob,grep] sealed | 0 | glob,grep,list_agents,wait_agent | 5 | 9 | 3 |
| provider | gated-root | 1 | read,grep,glob,list_agents,wait_agent | [read,grep,glob] | 0 | glob,grep,list_agents,wait_agent | 5 | 9 | 5 |
| provider | delegate-only | 1 | wait_agent,list_agents | [read,glob,grep] sealed | 0 | list_agents,wait_agent | 5 | 7 | 3 |
| toolkit-notes | gated | 2 | glob,grep,list_agents ; wait_agent,list_agents,read | [read,write,glob,grep] sealed | 0 | glob,grep,list_agents,wait_agent | 5 | 7 | 4 |
| toolkit-notes | gated-root | 3 | read,write,edit,glob,grep ; wait_agent,list_agents,send_message,todo_write ; glob,grep,wait_agent | [read,write,edit,glob,grep,bash,pwsh] ; [read,write,edit,glob,grep] | 0 | glob,grep,list_agents,send_message,todo_write,wait_agent,glob,grep | 5 | 8 | 7 |
| toolkit-notes | delegate-only | 2 | glob,grep ; wait_agent,glob,grep | [read,write,edit,glob,grep] | 0 | glob,grep,wait_agent | 5 | 8 | 7 |
| arch-split | gated | 5 | wait_agent,list_agents,send_message ; wait_agent,list_agents,send_message ; wait_agent,list_agents,send_message ; wait_agent,list_agents,send_message ; wait_agent,list_agents,send_message | [read,write,edit] sealed | 0 | list_agents,send_message,wait_agent | 5 | 8 | 3 |
| arch-split | gated-root | 1 | read,write,edit,glob,grep,list_agents,wait_agent,send_message | [read,write,edit] | 0 | glob,grep,list_agents,send_message,wait_agent | 5 | 10 | 5 |
| arch-split | delegate-only | 4 | wait_agent,list_agents ; wait_agent,list_agents ; wait_agent,list_agents ; glob,wait_agent,list_agents | [read,write,edit] ; [read] ; [read] ; [read] sealed | 0 | list_agents,wait_agent,glob | 5 | 8 | 5/3/3/1 |

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
