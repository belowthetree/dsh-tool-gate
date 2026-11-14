# dsh-tool-gate

把一个很小的基础工具集交给模型；**每个用户消息开始时，运行时上下文给出全部工具的简介**，模型用 `select_tools` 保留本轮需要的工具，直到下一次用户消息。

这套语义是"按轮次"的：

- 新用户消息 → 清空本轮选择 → 下一步只暴露基础工具，并在运行时上下文里列出**所有可保留工具的一行简介**；
- 模型调用 `select_tools` → 选择**替换**本轮集合 → 这些工具在本轮后续每一步都可用；
- 下一次用户消息 → 选择重置，目录重新给出。

没有字符串匹配、没有关键词路由：目录是状态，选择是一次工具调用。插件只负责校验名字和应用 `agent.ctx.tools.restrict({ allow })`。

## 为什么"下一步"生效

DSH 每一步开始时重新解析工具面：`tools.resolve()` → `systemPrompt.assemble()` → `agent/pre-step` → 模型请求。所以一次 `select_tools` 里改的限制，会进入下一个 step 的 `resolve`；agent loop 还会把与前一次 `request/header` 的差异写成 `developer/message`（`tool-addition`），模型在同一条请求里既看到工具结果，也看到新工具定义。同一 step 内拿不到新工具是结构性的——请求已经发出去了。

"下一次用户消息才重置"落在 `agent/inbox/claimed` 事件上：它在 claim 用户消息后、本步 `tools.resolve()` 之前同步触发，所以重置对"回复这条消息的那一步"就已生效。插件只认 `role: 'user'` 且 `source.kind === 'user'` 的消息——运行时上下文、子代理回报、steering 注入都不会误触发重置。

## 工具

| 工具 | 何时出现 | 作用 |
| --- | --- | --- |
| `select_tools` | 始终 | 用精确工具名替换本轮保留集；未知名字只报告不报错；基础工具列入 `Always available` |
| `delegate` | 组合里有 `subagents` 服务时 | 起一个子代理并指定它的精确工具清单（父代理预留，子代理首个请求前生效） |

目录不是工具调用：它是 `systemPrompt.context` 注册的运行时上下文（`tool-gate:catalog`，`required: true`），只在"本轮还没有选择"时渲染完整目录，选择之后换成一行"本轮已保留 + 其余可选名字"的摘要。

**目录是动态的，不是写死的**：它来自 `ctx.tools.schemas(agent)`——该 agent 从组合里继承到的全部工具注册（全局层 + Preset 层 + 它自己的 scope），所以第三方插件、MCP server、Agent Teams 等 contributed 的工具都会出现；`hiddenTools` 里的名字在快照阶段被剔除，`catalogTools` 非空时目录只保留其中列出的名字（基础工具与网关工具始终保留）。快照在 `agent/created` 时取一次，之后每个用户消息（`agent/inbox/claimed`）会重新取一次并**并入**新增的工具（用"临时 lift restriction → 读 → 重新 commit"的同步窗口），所以会话开始后才连上的 MCP 工具也会在下一轮出现在目录里。工具被移除时不做反向删除：名字会在 `commit` 的 restrictable 过滤里自然失效。

> 为什么 `catalogTools` 重要：profile 里装了很多 bundle/MCP 时，一个"标准"会话可能有 50+ 个工具；门控只决定**暴露**哪些，不会替你把目录变短。给编码向会话配一个 15 条左右的 allowlist，目录才是可读的，否则模型面对的是整个 profile 的工具清单。


```
Tool selection (restarts with every user message). Base tools are always exposed; 17 further tools can be kept for this turn:
- glob: List files by pattern…
- web_search: Search the web…
…
Call `select_tools` with the names this task needs. They stay exposed for the rest of this turn;
the next user message resets the selection and shows this catalog again.
```

## 聊天底部的工具数按钮

插件带一个浏览器半侧（`client.js`）：在 `conversation.composer.dock` 注册一个胶囊按钮，显示**本会话最近一次模型请求实际可调用的工具数**，点击在按钮上方展开详情（工具名 + 一行简介，基础工具标 `基础`）。

数字来自 Host 侧注册的 session projection（key `toolGate`，`wire.view` 只折叠 `request/header` 事件），浏览器侧只用 `props.useProjection('toolGate')` 读取，不重放会话事件。所以：

- 门控开启时，数字会随 `select_tools` / `delegate` 改变而变（每次工具面变化都会写一条 `request/header`）；
- 门控关闭（`enabled: false`）时，它仍然显示当前组合的全部工具——相当于"只读看板"；
- 子代理会话各自显示自己的工具数。

按钮不需要刷新页面也能在已安装后热加载；如果浏览器半侧没有出现，刷新一次页面即可。

## 预设与设置

bundle 的 patch 里还声明了一个 Agent 预设 **Tool Gate**（id `tool-gate`，排在 roster 的 order 20）：一个**编码向的精简组合**（fs / shell / jobs / skill / goal / plan / compaction / subagent / ask-user / todo / web / present），去掉了 office、workflow、subagent-fork、schedule、plugin-manager 等目录噪音。会话选到它就会进入门控。

默认**只门控选了这个预设的会话**；其他预设（standard 等）完全不受影响，并且插件会把 `select_tools` / `delegate` 从这些预设的工具面里隐藏（全局注册的工具必须显式 deny，否则会出现在每个预设里）。

**决定时机**：会话在空白期仍可切换预设，所以 `agent/created` 时只是暂定；每次用户消息（`agent/inbox/claimed`）会按已提交的预设重新判定一次——从 standard 切到 Tool Gate 会安装门控，反向切换会撤下门控并恢复完整工具面。

bundle 自己的设置页在 **Plugins → dsh-tool-gate** 的 `plugins.bundle.config` 位置，提供两个开关，写回该行的 Host config：

| 开关 | 字段 | 说明 |
| --- | --- | --- |
| 启用工具限制 | `enabled` | 关闭后只保留 dock 上的工具数按钮 |
| 在其他预设中也生效 | `applyToOtherPresets` | 打开后所有 Agent 预设都会被门控（对新会话生效） |

设置通过 `settings.describe` / `settings.mutate` 读写行配置；改普通字段会让 Host 重启该插件，因此已有的会话保持原来的工具面，新会话才使用新值。

## 安装

```sh
cd E:/Project/dsh-plugins/dsh-tool-gate
node scripts/build.mjs                      # 生成 lib/，并把用到的 DSH 包链进 node_modules
pnpm dsh plugin --profile <profile> add E:/Project/dsh-plugins/dsh-tool-gate
pnpm dsh --profile <profile> --dump-config  # 不启动也能确认这一行装上了
```

`scripts/build.mjs` 自动定位 DSH 检出（`DSH_CHECKOUT` 优先，其次探 `E:/Project/deepseek-harness` 等），把插件 imports 的 workspace 包以目录链接放进插件自己的 `node_modules`。**出树插件不能指望 profile 提供 `dsh-tools`**，必须自带；链接是幂等的，第二次构建起不再需要写权限。

## 配置

```yaml
- insert:
    - id: tool-gate
      name: dsh-tool-gate
      config:
        enabled: true                                # false = 只保留工具数按钮，不限制任何工具
        baseTools: [read, write, edit, glob, grep]   # 首步常驻；本组合没有的名字自动忽略
        selectToolName: select_tools                # 两个工具名都必须匹配 ^[a-z][a-z0-9_]*$ 且互不相同
        delegateToolName: delegate
        delegateProvider: spawn                     # 承载委派子代理的后端（subagent provider）
        delegateSealed: false                       # true = 默认 sealed，子代理不能自己选工具
        applyToSubagents: true                      # false = 只门控根会话；delegate 预留的子代理仍受控
        presetId: tool-gate                         # 本 bundle 的预设 id；只门控该预设的会话
        applyToOtherPresets: false                  # true = 其他预设也门控（等同"全局生效"）
        hiddenTools: []                             # 永久隐藏：不进目录、不可选、不可委派
        catalogTools: [pwsh, subagent, todo_write]  # 目录白名单；空 = 继承到的全部工具
        maxDescriptionChars: 160                    # 目录里每条简介的截断长度（>=24）
```

`baseTools` 里带 `pwsh` 和 `bash` 两个条目是刻意的：Windows 组合只有前者、POSIX 组合只有后者，安装时会按实际注册情况过滤。

## 委派：父代理指定子代理的工具

`delegate({ description, prompt, tools, sealed?, cwd? })`：`tools` 是子代理的**完整工具面**（只列它需要的）；`sealed: true` 时连网关工具都不给。实现方式是先 `reserve` 子会话 id 与清单，再 `subagents.startActivation()`；网关在 `agent/created`（串行、早于子代理首个请求）认领预留并装 `restrict({ allow: tools })`。启动失败会释放预留。**不是动态 preset**：子代理继承父的组合，只有工具面不同；预留 id 只有本地后端（默认 `spawn`）支持。

## 边界（有意为之）

- **只作用于继承层**：`restrict` 过滤全局与 Agent Preset 贡献的工具；插件在 `agent.ctx` 自注册的工具不受影响。
- **取交集**：别的插件也在限制时只能越收越窄。
- **失败即放行**：`restrict` 因某个名字拒绝时先剔除该名字重试，再失败就保持不限制并在工具结果里告警。
- **子代理默认受控**：所有新 agent 都会装网关；`applyToSubagents: false` 时只门控根会话，但 `delegate` 预留的子代理仍按父代理给的清单受控。
- **预留子代理不随消息重置**：`delegate` 拉起的子代理，其"本轮保留集"就是父代理给的清单；派发时的那条用户消息（子代理的首条 prompt）不会清空它。子代理仍可自己 `select_tools` 换工具（除非 sealed）。
- **`hiddenTools` / `catalogTools`**：都在快照阶段生效——`hiddenTools` 是黑名单，`catalogTools` 是白名单（空 = 全部）；白名单外的名字既不出现在目录里，也不能被选中或被 `delegate` 指定。
- **`delegate` 是延迟注册的**：`subagents` 服务可能晚于本插件激活，因此委派工具在服务出现时注册，并把名字补进已安装 agent 的工具面。
- **不支持撤销**：只有"本轮保留"，没有"保留后立刻收回"；重置只发生在下一个用户消息。
- **工具数按钮是只读投影**：它在 Host 侧折叠 `request/header`，不回放会话事件；`enabled: false` 时不限制任何工具，只保留按钮。若浏览器半侧从未收到该 projection（例如注册晚于会话打开），刷新一次页面即可。
- **缓存代价**：每次选择都会让 `request/header` 变化一次并写一条 `developer/message`；支持 `toolUpdate` 的路由不会因此开新 series。
- **只对新会话生效**：插件热重载不会追溯已经创建的 agent。

## 开发

```sh
node scripts/build.mjs          # 构建 lib/
node scripts/build.mjs --noEmit # 只做类型检查
node tests/all.mjs              # 66 条测试
node --check client.js          # 浏览器半侧是手写模块，无构建步骤
```

排查时设 `DSH_TOOL_GATE_DEBUG=1`，插件会把 `install`/`reserve`/`select`/`commit` 的决策打到 stderr。

测试用一个复刻 restriction 语义的内存工具注册表（`tests/support/fake-tools.mjs`），覆盖：安装后只剩基础+网关工具、目录内容、选择替换语义、未知名字不炸、新用户消息重置、非用户消息不重置、`hiddenTools`、`applyToSubagents`、委派清单/delegate 预留/sealed、配置校验、`enabled: false` 只注册投影、工具面投影的折叠与 wire 校验。

## 实验：开启 vs 不开启

[tests/compare/](tests/compare/README.md) 是真实模型的 A/B 实验（fixture：`dsh-channel-manager` 的独立副本，四臂：`control` / `gated` / `gated-root` / `delegate-only`）。

**注意**：`RESULTS-SUMMARY.md` 里较早的数据来自旧设计（`list_tools` + `enable_tools` + 按需解锁）；当前实现（每轮目录 + `select_tools`）的数据是 `RESULTS-catalog.*` / `RESULTS-catalog2.*`，两轮重复见 summary 的"两次重复的合并读法"。要新结论：

```sh
node tests/compare/compare.mjs --tasks=all --arms=control,gated,gated-root,delegate-only --label=catalog3
node tests/compare/report.mjs catalog3
```
