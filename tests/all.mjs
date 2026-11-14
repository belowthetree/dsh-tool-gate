/**
 * Run every suite in one process.
 *
 * `node --test` spawns one child per file over piped stdio, which a confined
 * shell refuses; importing the suites keeps the whole run in this process, so
 * `npm test` works anywhere. `node --test` still works in an unconfined shell.
 *
 * @module dsh-tool-gate/tests/all
 */

import './plugin.test.mjs'
import './gate.test.mjs'
import './tools.test.mjs'
import './delegate.test.mjs'
import './surface.test.mjs'
