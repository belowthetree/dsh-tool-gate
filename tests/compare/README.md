# 工具门控 A/B 实验（dsh-tool-gate）

同一套任务、同一个模型、同一个实验体仓库，只换**根代理看到的工具面**：

| 臂 | 组合 | 根代理首请求工具面 |
| --- | --- | --- |
| `control` | 原样 headless profile | 23 个（read/write/edit/glob/grep/subagent/… 全暴露） |
| `gated` | 同上 + `dsh-tool-gate` | 5 个（read/write/edit + `select_tools` [+ `delegate`]），其余按每轮目录 + `select_tools` 保留 |
| `gated-root` | `gated` + `applyToSubagents: false` | 同上；**子代理不再被门控**，用来分离"父代理克制"与"子代理上下文缩小" |
| `delegate-only` | `gated` + `hiddenTools: [subagent, subagent_fork]` | 同上；强制委派只能走 `delegate`，用来评估"父代理指定子代理工具面" |

新增一个臂 = 加一份 `overlay-<arm>.patch.yml`：`compare.mjs` 按名字找 overlay，不再写死臂列表。

两臂跑同一份 prompt、同一个 `dsh-channel-manager` 副本、同一个 provider/模型
（`opencode-go/deepseek-v4.1-flash`，`reasoningEffort: max`），各自独立进程、独立
`DSH_HOME` 与会话库，所以差异只可能来自工具面。

## 怎么跑

```powershell
cd E:\Project\dsh-plugins\dsh-tool-gate\tests\compare
node compare.mjs --tasks=all --arms=control,gated --timeout=300000 --label=full
```

参数：`--tasks=all|<id,id>`、`--arms=control,gated`、`--timeout=<单次上限 ms>`、
`--root=<暂存根>`、`--label=<报告标签>`、`--fixture=<被实验的仓库>`、`--sequential`（默认两臂并行）。

产物：`RESULTS-<label>.json` / `RESULTS-<label>.md`（按 label 各存一份）、`RESULTS.json` / `RESULTS.md`
（最新一次），以及人工整理的跨运行汇总 `RESULTS-SUMMARY.md`。每次运行在
`.compare-run/runs/<label>/<arm>-<task>/` 下留 `project/`、`.dsh/`、`.sessions/`、`run.log`、
`transcript.md` 与 `transcript.jsonl`。`node report.mjs [label]` 只重渲染报告，不再花钱调模型。

## 查看一次运行的会话

```sh
node sessions.mjs list                                  # 所有 label/arm/task 与目录
node sessions.mjs show catalog2 gated arch-split        # 打印 transcript.md
node sessions.mjs show catalog2 gated arch-split --json # 一行一条 JSON
node sessions.mjs open catalog2 gated arch-split        # 只打印目录
```

`transcript.md` 按时间顺序记录：user 消息、runtime-context（**含本轮工具目录原文**）、assistant 文本、
每次 tool call（含 JSON 参数）、每条 tool result、developer 的 tool-addition；根代理与每个子代理各一节。
`.sessions/**/session.v4.jsonl.zstd` 是 DSH 自己的持久日志（zstd JSONL），用于 replay，不适合人读。

scratch root 默认保留历史运行，按 label 分目录；只有 `--fresh` 才整个清空。

环境变量：`DSH_CHECKOUT`（检出目录，默认 `E:/Project/deepseek-harness`）、
`DSH_CMP_ROOT`（暂存根）、`DSH_CMP_CREDENTIALS`（凭据库，默认
`C:/Users/ZGG/.dsh/.credentials.yaml`）。需要完整权限运行。

## 任务集（`tasks.mjs`）

简单任务（只读，评分看根代理最终回答文本）：

| id | 要求 | 评分器要求出现的事实 |
| --- | --- | --- |
| `rows` | `cordis.patch.yml` 里每条 loader row 的 id → 包名 | `channel-manager-qqbot`、`dsh-channel-manager/channels/qqbot`、`dsh-channel-manager` |
| `qrbind` | 扫码绑定的实现路径、工厂函数名、超时 | `qq-bind.js`、`createQrBinder` |
| `provider` | `docs/ARCH.md §7` 的注册函数与 provider 方法 | `registerProvider` + `start`/`stop`/`status`/`send` 中至少两个 |

复杂任务（读多文件 + 写文件 + 读回验证，**评分直接读工作区**，不看模型自述）：

| id | 要求 | 评分器检查 |
| --- | --- | --- |
| `toolkit-notes` | 新建 `docs/TOOLKIT-NOTES.md`，含 loader row id、`registerProvider` 签名、`createQrBinder`，写完读回核对 | 文件存在且三件事齐全 |
| `arch-split` | 把 `ARCH.md §7` 的 provider 契约拆到 `docs/PROVIDER.md`（id/title/start/stop/status/send），并在 `ARCH.md §7` 加回链 | 新文件方法齐全 + 原文件含 `PROVIDER.md` |

## 指标从哪来

全部来自 harness 自己的会话事件，不做估算：

- **usage**：`assistant/message.usage`（provider 回报），拆成未命中缓存输入 / 缓存读 / 输出；
- **工具面**：第一次 `request/header` 的 `tools` 数组（工具数 + UTF-8 字节数）；
- **门控行为**：`select_tools` 调用、每轮的保留清单与 `developer/message` 的 `tool-addition` 增量；
- **派发**：`subagent` / `subagent_fork` / `delegate` 调用，以及每个子代理会话自己的 usage 与首个工具面；
- **完成度**：`tasks.mjs` 的确定性评分器，只看根代理最终回答文本。

## 环境事实（踩过的坑）

- headless profile 正常由 CLI 启动，`headless-startup` 注入 `cmdlineArgs`，
  `sandbox-policy → fs → workingDirectory → subagent` 整条链都挂在这上面。程序化 boot 没有
  launcher，所以 `run-one.mjs` 通过 `bootProductionProfile({ prepare })` 调
  `provideCmdline(ctx, { args: [] })` 补上，并只禁用 `headless-runner`（它会真去跑一个 task）。
- headless bundle 默认关掉 `credentials` 行（改用"启动时凭据"）。isolated home 里没有凭据，
  因此 overlay 用 `disabled: false` 重新启用它并指向真实的凭据库——只读，不复制、不写回。
- 两臂都禁用 `tool-pwsh` / `tool-bash`：任务不需要 shell，而且本机 pwsh 自身报
  `SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)`，留着会让两臂因环境缺陷失分。
- `subagent` 工具的 `delivery: 'parent'` 是异步的：父代理派发后本轮就结束，子代理完成后
  再唤醒父代理。所以 `run-one.mjs` 不能"等到根代理第一个 turn 结束"就收工，而是等到
  **所有 agent 连续空闲 8 秒**。

## 已知局限

- 每个 (任务, 臂) 只跑一次时，模型采样噪声远大于臂间差异：`gated` 与 `gated-root` 在这批运行里
  机制上几乎等价（所有委派都走 `delegate`，预留子代理在两种配置下都被门控），同一任务同一轮
  却能差到 **2.4×**（arch-split：738k vs 313k）。**要结论必须每格 3–5 次重复，报均值 + 极差**；
  跨运行汇总见 `RESULTS-SUMMARY.md`。
- 缓存读 token 与实际计费不成正比（各 provider 折扣不同）；报告把未命中输入单列，
  就是避免用总量夸大节省。
- `delegate` 曾经在服务就绪前注册失败（`ctx.get('subagents')` 在 apply 时为 undefined），
  第一批实验里 gated 臂其实没有委派工具。现在改成 `ctx.inject(['subagents'])` 延迟注册，
  并会把工具补进已安装 agent 的工具面（下一步生效）。
