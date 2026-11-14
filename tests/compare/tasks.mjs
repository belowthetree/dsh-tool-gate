/**
 * The task set for the gate experiment.
 *
 * Every task is a filesystem question about one fixture repository
 * (`dsh-channel-manager`), asking for a subagent to be dispatched. The prompt is
 * identical for both arms; only the exposed tool surface differs. Each grader is
 * deterministic: it reads the root agent's final answer text and looks for the
 * facts a correct answer must contain.
 *
 * @module dsh-tool-gate/tests/compare/tasks
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Case-insensitive substring check with whitespace normalisation. */
function has(text, needle) {
  return String(text ?? '').toLowerCase().includes(needle.toLowerCase())
}

/** Read one file inside the run's workspace, or undefined when absent. */
async function readWorkspaceFile(workspace, ...segments) {
  return readFile(join(workspace, ...segments), 'utf8').catch(() => undefined)
}

/** All task definitions, in run order. */
export const TASKS = [
  {
    id: 'rows',
    prompt: '在本次会话的工作目录里，查看 cordis.patch.yml，找出其中插入的每条 loader row：'
      + '把每条 row 的 id 和它挂载的包名成对列出（id → name）。'
      + '请派一个子代理去查，然后把结论原样汇报给我。',
    /**
     * @param {string | undefined} text The root agent's final answer.
     * @returns {{completed: boolean, note: string}} The grade.
     */
    grade(text) {
      const completed = has(text, 'channel-manager-qqbot')
        && has(text, 'dsh-channel-manager/channels/qqbot')
        && has(text, 'dsh-channel-manager')
      return { completed, note: completed ? 'both rows and both package names present' : 'a row id or package name is missing' }
    },
  },
  {
    id: 'qrbind',
    prompt: '在这个仓库里找到 QQ 扫码自动绑定的实现：回答它的相对路径，以及它导出的创建绑定器的函数名，并说明绑定超时是多少。'
      + '请派一个子代理去查，然后把结论原样汇报给我。',
    /**
     * @param {string | undefined} text The root agent's final answer.
     * @returns {{completed: boolean, note: string}} The grade.
     */
    grade(text) {
      const completed = has(text, 'qq-bind.js') && has(text, 'createQrBinder')
      return { completed, note: completed ? 'file and factory named' : 'file path or factory name missing' }
    },
  },
  {
    id: 'provider',
    prompt: '阅读 docs/ARCH.md 第 7 节（Channel provider 契约），回答两件事：'
      + '① 把 provider 挂进 manager 的注册函数名；② provider 对象必须提供哪些方法（至少说出两个）。'
      + '请派一个子代理去查，然后把结论原样汇报给我。',
    /**
     * @param {string | undefined} text The root agent's final answer.
     * @returns {{completed: boolean, note: string}} The grade.
     */
    grade(text) {
      const methods = ['start', 'stop', 'status', 'send'].filter(method => has(text, method))
      const completed = has(text, 'registerProvider') && methods.length >= 2
      return {
        completed,
        note: completed ? `registerProvider + ${methods.join('/')}` : 'registerProvider or two provider methods missing',
      }
    },
  },
  {
    // Complex task 1: read several files, write one, read it back, report.
    // Graded from the workspace, not from the answer text.
    id: 'toolkit-notes',
    prompt: '在这个仓库里做一件事：派一个子代理新建 `docs/TOOLKIT-NOTES.md`，文件里至少写清三件事——'
      + '① `cordis.patch.yml` 里两条 loader row 的 id；② provider 的注册函数签名；③ QQ 扫码绑定的工厂函数名。'
      + '子代理写完后必须把文件读回来核对一遍，确认存在且内容正确，再把结论汇报给我。',
    /**
     * @param {string | undefined} _text The root agent's final answer.
     * @param {{workspace: string}} context The run context.
     * @returns {Promise<{completed: boolean, note: string}>} The grade.
     */
    async grade(_text, { workspace }) {
      const content = await readWorkspaceFile(workspace, 'docs', 'TOOLKIT-NOTES.md')
      if (content === undefined) return { completed: false, note: 'docs/TOOLKIT-NOTES.md was not created' }
      const facts = ['channel-manager-qqbot', 'registerProvider', 'createQrBinder']
      const missing = facts.filter(fact => !has(content, fact))
      return {
        completed: missing.length === 0,
        note: missing.length === 0 ? 'notes file carries all three facts' : `missing: ${missing.join(', ')}`,
      }
    },
  },
  {
    // Complex task 2: split a section into a new file and link it from the source.
    // Graded from the workspace: the new file plus the edit in the original.
    id: 'arch-split',
    prompt: '在这个仓库里做一件事：派一个子代理把 `docs/ARCH.md` 第 7 节的 provider 契约整理成新文件 `docs/PROVIDER.md`'
      + '（要保留 provider 对象的 id、title 以及 start/stop/status/send 这五个要点），'
      + '并在 `docs/ARCH.md` 第 7 节开头加一行指向 `PROVIDER.md` 的链接。'
      + '改完让子代理读回两个文件确认无误，再把结论汇报给我。',
    /**
     * @param {string | undefined} _text The root agent's final answer.
     * @param {{workspace: string}} context The run context.
     * @returns {Promise<{completed: boolean, note: string}>} The grade.
     */
    async grade(_text, { workspace }) {
      const provider = await readWorkspaceFile(workspace, 'docs', 'PROVIDER.md')
      const arch = await readWorkspaceFile(workspace, 'docs', 'ARCH.md')
      if (provider === undefined) return { completed: false, note: 'docs/PROVIDER.md was not created' }
      const methods = ['start', 'stop', 'status', 'send'].filter(method => has(provider, method))
      const linked = arch !== undefined && has(arch, 'PROVIDER.md')
      const completed = methods.length >= 3 && has(provider, 'id') && linked
      return {
        completed,
        note: completed
          ? 'provider doc + back-link present'
          : `methods=${methods.join('/') || 'none'} linked=${linked}`,
      }
    },
  },
]

/**
 * Find one task by id.
 * @param {string} id Task id.
 * @returns {object} The task.
 */
export function taskById(id) {
  const task = TASKS.find(candidate => candidate.id === id)
  if (task === undefined) throw new Error(`unknown task "${id}" (known: ${TASKS.map(candidate => candidate.id).join(', ')})`)
  return task
}

/**
 * Select tasks from a `--tasks` value (`all` or a comma-separated id list).
 * @param {string | undefined} value The raw flag value.
 * @returns {object[]} The selected tasks.
 */
export function selectTasks(value) {
  if (value === undefined || value === 'all' || value === '') return TASKS
  return value.split(',').map(part => part.trim()).filter(Boolean).map(taskById)
}
