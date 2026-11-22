// Offline source-derived regression harness. No server, DB, network, or packages.
// Executes the Pawn transport after a small syntax translation; native boundaries
// are simulated. This is NOT an AMX VM / sockets module / gameplay runtime test.
// Run: node test_sync_transport.mjs [path/to/freenova_sync.sma]
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const source = readFileSync(process.argv[2] || fileURLToPath(new URL('../../Server CS 1.6/cstrike/addons/amxmodx/scripting/freenova_sync.sma', import.meta.url)), 'utf8')
function body(name) {
  const match = source.match(new RegExp(`^(?:public |stock )?(?:bool:)?${name}\\([^\\n]*\\)\\s*\\{`, 'm'))
  assert.ok(match, `production function ${name} exists`)
  let pos = match.index + match[0].length, start = pos, depth = 1, quote = ''
  for (; depth && pos < source.length; pos++) {
    const ch = source[pos]
    if (quote) { if (ch === '^') pos++; else if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '/' && source[pos + 1] === '/') { pos = source.indexOf('\n', pos); continue }
    if (ch === '{') depth++
    if (ch === '}') depth--
  }
  return source.slice(start, pos - 1)
}

// Preserve Pawn NUL-terminated cell strings and reference/suffix arguments.
const cells = n => Array(n).fill(0)
const text = a => typeof a === 'string' ? a : String.fromCharCode(...a.slice(0, a.indexOf(0) < 0 ? a.length : a.indexOf(0)))
const put = (a, s, max) => { s = text(s).slice(0, max); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); a[s.length] = 0; return s.length }
const ptr = (a, offset) => new Proxy(a, {
  get(t, k) { if (k === 'length') return t.length - offset; if (/^\d+$/.test(String(k))) return t[Number(k) + offset]; return Reflect.get(t, k) },
  set(t, k, v) { t[Number(k) + offset] = v; return true }
})
function translate(code) {
  const strings = []
  code = code.replace(/\/\/[^\n]*|"(?:\^.|[^"\n])*"|'(?:\^.|[^'\n])*'/g, token => {
    if (token.startsWith('//')) return ''
    const quote = token[0], value = token.slice(1, -1).replace(/\^([rn t"'^])/g, (_, c) => ({ r: '\r', n: '\n', t: '\t' }[c] ?? c))
    strings.push(quote === "'" ? String(value.charCodeAt(0)) : JSON.stringify(value))
    return `__STR${strings.length - 1}__`
  })
  code = code.replace(/\b(?:bool|JSON|Float):/g, '')
  code = code.replace(/\b(?:new|static) ([^;\n]+)/g, (_, declarations) => {
    // A comma inside an initializer belongs to its call, not the declaration.
    const parts = []; let start = 0, depth = 0
    for (let i = 0; i < declarations.length; i++) {
      if ('(['.includes(declarations[i])) depth++
      if (')]'.includes(declarations[i])) depth--
      if (declarations[i] === ',' && depth === 0) { parts.push(declarations.slice(start, i)); start = i + 1 }
    }
    parts.push(declarations.slice(start))
    return 'let ' + parts.map(p => {
      p = p.trim()
      const a = p.match(/^(\w+)\[([^\]]+)\]$/)
      if (a) return `${a[1]} = cells(${a[2]})`
      return /^\w+$/.test(p) ? `${p} = 0` : p
    }).join(', ')
  })
  // Known native array parameters take pointers rather than a single cell.
  for (const name of ['socket_send', 'socket_send2', 'socket_recv', 'copy', 'formatex', 'equal', 'equali', 'strfind', 'strlen', 'json_parse', 'SyncDecimal', 'ParseAndExecuteActions', 'SyncJsonObject']) {
    code = code.replace(new RegExp(`\\b${name}\\(([^\\n]*)`, 'g'), (_, tail) => name + '(' + tail.replace(/\b(sz\w*|g_szRespBuf)\[([^\[\]]+)\]/g, 'ptr($1, $2)'))
  }
  code = code.replace(/\bcharsmax\((\w+)\[\]\)/g, '($1[0].length - 1)')
  code = code.replace(/\bcharsmax\((\w+)\)/g, '($1.length - 1)').replace(/\bsizeof\((\w+)\)/g, '$1.length')
  code = code.replace(/socket_open\(([^\n]+), iErr, /g, 'socket_open($1, value => iErr = value, ')
  code = code.replace(/__STR(\d+)__/g, (_, i) => strings[i])
  return code
}

function fixture() {
  const sent = [], tasks = new Map(), executed = [], logs = []
  const c = {
    cells, ptr, Math, min: Math.min, max: Math.max,
    g_iActiveSocket: 7, g_iPollTicks: 0, g_iFailStreak: 0,
    g_iTransportState: 1, SYNC_HEADER: 1, SYNC_BODY: 2, SYNC_RECEIVE: 3,
    g_iSendOffset: 0, g_iHeaderLength: 4, g_iBodyLength: 4,
    g_iResponseLength: 0, g_iSentResultCount: 1, g_bPushAgain: false,
    g_fSyncDeadline: 15, now: 0, writable: false, recv: [], sendLimit: 100000,
    szHeader: cells(768), szBody: cells(16384), g_szRespBuf: cells(8192),
    g_iActionResultCount: 1, g_iActionResultId: [42, ...cells(15)],
    g_bActionResultOk: [true, ...cells(15)], g_szActionResultMsg: Array.from({ length: 16 }, () => cells(64)),
    TASK_PUSH: 32100, TASK_POLL: 32200, MAX_QUEUED_ACTIONS: 16,
    Invalid_JSON: -1, JSONObject: 4, JSONArray: 5, JSONBoolean: 6, JSONString: 2, JSONNumber: 3,
    strlen: a => text(a).length,
    strfind: (a, s, insensitive = false) => insensitive ? text(a).toLowerCase().indexOf(text(s).toLowerCase()) : text(a).indexOf(text(s)),
    equal: (a, b, n) => n ? text(a).slice(0, n) === text(b).slice(0, n) : text(a) === text(b),
    equali: (a, b, n) => n ? text(a).slice(0, n).toLowerCase() === text(b).slice(0, n).toLowerCase() : text(a).toLowerCase() === text(b).toLowerCase(),
    copy: (a, n, s) => put(a, s, n),
    formatex: (a, n, fmt, ...args) => { let i = 0; return put(a, fmt.replace(/%[sd]/g, spec => spec === '%s' ? text(args[i++]) : String(args[i++])), n) },
    add: (a, n, s) => put(a, text(a) + text(s), n),
    isdigit: ch => ch >= 48 && ch <= 57,
    isalnum: ch => ch >= 48 && ch <= 57 || ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122,
    get_gametime: () => c.now,
    socket_is_writable: (_, timeout) => { assert.equal(timeout, 0); return c.writable },
    socket_is_readable: (_, timeout) => { assert.equal(timeout, 0); return c.recv.length > 0 },
    socket_send: (_, a) => { const s = text(a); if (c.sendLimit <= 0) return c.sendLimit; const n = Math.min(s.length, c.sendLimit); sent.push(s.slice(0, n)); return n },
    socket_recv: (_, a, n) => { const next = c.recv.shift(); if (typeof next === 'number') return next; const bytes = next.slice(0, n - 1); put(a, bytes, n - 1); if (next.length > bytes.length) c.recv.unshift(next.slice(bytes.length)); return bytes.length },
    socket_close: () => { c.closed = (c.closed || 0) + 1 },
    remove_task: id => tasks.delete(id), task_exists: id => tasks.has(id),
    set_task: (delay, fn, id) => tasks.set(id, { delay, fn }),
    log_amx: (...args) => logs.push(args),
    ExecuteAction: (...args) => { executed.push([args[0], ...args.slice(1).map(text)]); c.RecordActionResult(args[0], true, 'done') },
    json_parse: a => { try { return JSON.parse(text(a)) } catch { return -1 } },
    json_free: () => {},
    json_get_type: v => v === null ? 1 : Array.isArray(v) ? 5 : ({ object: 4, boolean: 6, string: 2, number: 3 }[typeof v] ?? -1),
    json_is_object: v => c.json_get_type(v) === 4,
    json_is_array: v => c.json_get_type(v) === 5,
    json_object_has_value: (v, k, type) => Object.hasOwn(v, k) && c.json_get_type(v[k]) === type,
    json_object_get_bool: (v, k) => v[k] === true,
    json_object_get_value: (v, k) => v[k] ?? -1,
    json_object_get_number: (v, k) => Math.trunc(v[k] || 0),
    json_object_get_string: (v, k, a, n) => put(a, v[k], n),
    json_array_get_count: v => v.length,
    json_array_get_value: (v, i) => v[i],
    json_serial_to_string: (v, a, n) => put(a, JSON.stringify(v), n),
  }
  put(c.szHeader, 'HEAD', 767); put(c.szBody, 'BODY', 16383)
  const names = ['Task_PollResponse', 'FinishPush', 'ValidateSyncResponse', 'SyncDecimal', 'SyncNumericHost', 'SyncJsonEnvelope', 'SyncJsonObject', 'ValidateSyncActions', 'ParseAndExecuteActions', 'RetireSentResults', 'RecordActionResult', 'plugin_end']
  vm.createContext(c)
  for (const name of names) {
    if (!new RegExp(`^(?:public |stock )?(?:bool:)?${name}\\(`, 'm').test(source)) continue
    const args = source.match(new RegExp(`^(?:public |stock )?(?:bool:)?${name}\\(([^\\n]*)\\)`, 'm'))[1].replace(/\bconst |\b(?:bool|JSON|Float):|\[\]/g, '')
    vm.runInContext(`function ${name}(${args}) {${translate(body(name))}\n}`, c, { filename: name })
  }
  // Exercise the real busy guard, before snapshot/native construction.
  const busy = body('BuildAndPush').split('new iPlayers')[0]
  c.get_pcvar_num = p => p === 'port' ? 8080 : 1
  c.get_pcvar_string = (p, a, n) => put(a, ({ host: '127.0.0.1', path: '/api/v1/server/stats', server: 'test', vhost: '' }[p] ?? 'fixture'), n)
  c.g_pEnabled = 1; c.g_pSecret = 2; c.g_pHost = 'host'; c.g_pPath = 'path'; c.g_pServerId = 'server'; c.g_pPort = 'port'; c.g_pVHost = 'vhost'
  c.SOCKET_TCP = 1; c.SOCK_NON_BLOCKING = 1; c.Hash_Sha256 = 1
  c.szSecret = [...Buffer.from('offline-fixture'), 0]
  c.time = () => 123; c.random_num = () => 100000
  c.hash_string = (_, type, a, n) => put(a, '0'.repeat(64), n)
  c.openResult = 7; c.openError = 3
  c.socket_open = (host, port, protocol, error, flags) => {
    assert.equal(text(host), '127.0.0.1'); assert.equal(port, 8080); assert.equal(flags, 1)
    error(c.openError); return c.openResult
  }
  vm.runInContext(`function pushWhileBusy() {${translate(busy)}}`, c)
  // Execute the actual connection/signature/header/task tail with synthetic body
  // and credentials. Snapshot generation/gameplay natives are outside this test.
  const start = body('BuildAndPush').slice(body('BuildAndPush').indexOf('new szHost[64]'))
  vm.runInContext(`function startTransport() {${translate(start)}}`, c)
  return { c, sent, tasks, executed, logs, poll: () => c.Task_PollResponse() }
}

const action = { id: 51, steamid: 'STEAM_0:1:123', type: 'give_coins', arg: '10', attempts: 0 }
const good = JSON.stringify({ ok: true, stored: 0, server_time: 123, actions: [action] })
const http = (json = good, headers = '', status = '200 OK') => `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\n${headers}\r\n${json}`
let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++ }
  catch (e) { console.error(`FAIL ${name}: ${e.stack}`); failed++ }
}
check('overlapping pushes preserve active descriptor and coalesce', () => {
  const { c, tasks } = fixture(); c.pushWhileBusy(); c.pushWhileBusy()
  assert.equal(c.g_iActiveSocket, 7); assert.equal(c.closed || 0, 0); assert.equal(c.g_bPushAgain, true); assert.equal(tasks.size, 0)
})
check('connect waits for writable; short writes keep header before body; ACK retained', () => {
  const f = fixture(); f.poll(); assert.equal(f.sent.join(''), '')
  f.c.writable = true; f.c.sendLimit = 1
  for (let i = 0; i < 8; i++) f.poll()
  assert.equal(f.sent.join(''), 'HEADBODY'); assert.equal(f.c.g_iActionResultCount, 1)
})
check('positive pending descriptor plus generic error 3 starts polling without immediate sends', () => {
  const f = fixture(); f.c.g_iActiveSocket = 0; f.c.startTransport()
  assert.equal(f.c.g_iActiveSocket, 7); assert.equal(f.tasks.get(32200).fn, 'Task_PollResponse')
  assert.equal(f.sent.length, 0); f.poll(); assert.equal(f.sent.length, 0)
  f.c.writable = true; f.c.sendLimit = 17
  for (let i = 0; i < 100 && f.c.g_iTransportState !== 3; i++) f.poll()
  const wire = f.sent.join('')
  assert.match(wire, /^POST \/api\/v1\/server\/stats HTTP\/1\.0\r\n/)
  assert.ok(wire.endsWith('Content-Length: 4\r\nConnection: close\r\n\r\nBODY'))
  assert.equal(wire.split('\r\n\r\n').length, 2); assert.equal(f.c.g_iActionResultCount, 1)
})
check('failed open keeps ACKs without scheduling socket polling', () => {
  const f = fixture(); f.c.g_iActiveSocket = 0; f.c.openResult = -1; f.c.startTransport()
  assert.equal(f.c.g_iActiveSocket, 0); assert.equal(f.tasks.size, 0); assert.equal(f.sent.length, 0); assert.equal(f.c.g_iActionResultCount, 1)
})
check('would-block after a partial write resumes the retained suffix', () => {
  const f = fixture(); f.c.writable = true; f.c.sendLimit = 2; f.poll()
  f.c.sendLimit = -1; f.poll(); assert.equal(f.c.g_iSendOffset, 2)
  f.c.sendLimit = 0; f.poll(); assert.equal(f.c.g_iSendOffset, 2)
  f.c.sendLimit = 2; for (let i = 0; i < 3; i++) f.poll()
  assert.equal(f.sent.join(''), 'HEADBODY')
})
function receiving() {
  const f = fixture(); f.c.writable = true; f.poll(); f.poll(); return f
}
check('fragmented close-delimited Node response executes only after EOF, retires old ACK', () => {
  const f = receiving()
  for (const ch of http()) { f.c.recv.push(ch); f.poll(); assert.equal(f.executed.length, 0) }
  assert.equal(f.c.g_iActionResultCount, 1)
  f.c.recv.push(0); f.poll()
  assert.equal(f.executed.length, 1); assert.equal(f.c.g_iActionResultCount, 1); assert.equal(f.c.g_iActionResultId[0], 51)
})
check('Content-Length response waits for clean EOF and accepts exact bytes', () => {
  const f = receiving(); f.c.recv.push(http(good, `Content-Length: ${Buffer.byteLength(good)}\r\n`)); f.poll()
  assert.equal(f.executed.length, 0); f.c.recv.push(0); f.poll(); assert.equal(f.executed.length, 1)
})
for (const [name, response] of [
  ['error status with valid actions', http(good, '', '500 Error')],
  ['application failure', http(JSON.stringify({ ok: false, actions: [action] }))],
  ['truncated JSON', http(good.slice(0, -1))],
  ['trailing JSON garbage', http(good + '{}')],
  ['wrong Content-Length', http(good, 'Content-Length: 1\r\n')],
  ['duplicate Content-Length', http(good, 'Content-Length: 1\r\nContent-Length: 1\r\n')],
  ['unsupported chunked framing', http(good, 'Transfer-Encoding: chunked\r\n')],
  ['malformed header', http(good, 'Broken header\r\n')],
  ['invalid header token', http(good, 'X@Header: value\r\n')],
  ['bare LF in header value', http(good, 'X-Header: value\ninjected\r\n')],
  ['control character in status line', http(good, '', '200 O\x01K')],
  ['missing actions', http('{"ok":true}')],
  ['invalid later action prevents first execution', http(JSON.stringify({ ok: true, actions: [action, { id: 52 }] }))],
  ['oversized action argument', http(JSON.stringify({ ok: true, actions: [{ ...action, arg: 'x'.repeat(65) }] }))],
  ['embedded NUL', http(good + '\0')],
  ['escaped NUL in action', http(JSON.stringify({ ok: true, actions: [{ ...action, arg: '10\0ignored' }] }))],
  ['fractional action ID', http(JSON.stringify({ ok: true, actions: [{ ...action, id: 1.5 }] }))],
  ['overflow action ID', http(JSON.stringify({ ok: true, actions: [{ ...action, id: 2147483648 }] }))],
  ['duplicate action IDs', http(JSON.stringify({ ok: true, actions: [action, action] }))],
  ['replayed unconfirmed action', http(JSON.stringify({ ok: true, actions: [{ ...action, id: 42 }] }))],
  ['oversized batch', http(JSON.stringify({ ok: true, actions: Array.from({ length: 9 }, (_, i) => ({ ...action, id: 100 + i })) }))],
  ['empty body', http('')],
  ['missing header terminator', 'HTTP/1.1 200 OK\r\n' + good],
  ['invalid status prefix', http(good, '', '2000 Fake')],
  ['negative length', http(good, 'Content-Length: -1\r\n')],
  ['overflow length', http(good, 'Content-Length: 4294967296\r\n')],
  ['nonnumeric length', http(good, 'Content-Length: 100xyz\r\n')],
  ['compressed response', http(good, 'Content-Encoding: gzip\r\n')],
]) check(`rejects ${name} without ACK loss or actions`, () => {
  const f = receiving(); f.c.recv.push(response, 0); for (let i = 0; i < 20 && f.c.g_iActiveSocket; i++) f.poll()
  assert.equal(f.executed.length, 0); assert.equal(f.c.g_iActionResultCount, 1); assert.equal(f.c.g_iActionResultId[0], 42)
})
check('timeout never executes a complete-looking response without EOF', () => {
  const f = receiving(); f.c.recv.push(http()); f.poll(); f.c.now = 20
  for (let i = 0; i < 30 && f.c.g_iActiveSocket; i++) f.poll()
  assert.equal(f.executed.length, 0); assert.equal(f.c.g_iActiveSocket, 0); assert.equal(f.c.g_iActionResultCount, 1)
})
check('receive error is not EOF', () => {
  const f = receiving(); f.c.recv.push(http(), -1); f.poll(); f.poll()
  assert.equal(f.executed.length, 0); assert.equal(f.c.g_iActionResultCount, 1)
  f.c.recv.push(0); f.poll(); assert.equal(f.executed.length, 0)
})
check('bounded receive overflow fails closed', () => {
  const f = receiving(); f.c.recv.push(http(good + ' '.repeat(9000)), 0)
  for (let i = 0; i < 30 && f.c.g_iActiveSocket; i++) f.poll()
  assert.equal(f.executed.length, 0); assert.equal(f.c.g_iActiveSocket, 0); assert.equal(f.c.g_iActionResultCount, 1)
})
check('send errors retain offsets and ACK until bounded timeout', () => {
  const f = fixture(); f.c.writable = true; f.c.sendLimit = -1; f.poll()
  assert.equal(f.c.g_iSendOffset, 0); assert.equal(f.c.g_iActionResultCount, 1)
  f.c.now = 20; for (let i = 0; i < 30 && f.c.g_iActiveSocket; i++) f.poll()
  assert.equal(f.c.g_iActiveSocket, 0); assert.equal(f.c.g_iActionResultCount, 1)
})
check('successful empty batch retires only sent ACK prefix, preserving newly queued ACKs', () => {
  const f = receiving(); f.c.RecordActionResult(43, false, 'rejected')
  f.c.recv.push(http('{"ok":true,"actions":[]}'), 0); f.poll()
  assert.equal(f.c.g_iActionResultCount, 1); assert.equal(f.c.g_iActionResultId[0], 43)
  assert.equal(f.c.g_bActionResultOk[0], false); assert.equal(text(f.c.g_szActionResultMsg[0]), 'rejected')
})
check('valid braces, backslashes and 64-byte argument are decoded without truncation', () => {
  const f = receiving(); const arg = '{}\\' + 'x'.repeat(61)
  f.c.recv.push(http(JSON.stringify({ ok: true, actions: [{ ...action, arg }] })), 0); f.poll()
  assert.equal(f.executed.length, 1); assert.equal(f.executed[0][3], arg)
})
check('receive work is bounded to four chunks per poll', () => {
  const f = receiving(); f.c.recv.push(...Array(10).fill('x')); f.poll()
  assert.equal(f.c.recv.length, 6); assert.equal(f.c.g_iResponseLength, 4)
})
check('busy pushes schedule one deferred push on failure', () => {
  const f = receiving(); for (let i = 0; i < 10; i++) f.c.pushWhileBusy()
  f.c.now = 20; f.poll(); assert.equal(f.tasks.size, 1); assert.equal(f.tasks.get(32101).fn, 'Task_PushSoon')
})
check('action burst schedules one ACK follow-up, including rejected results', () => {
  const f = fixture(); for (let i = 0; i < 8; i++) f.c.RecordActionResult(100 + i, false, 'rejected')
  assert.equal(f.tasks.size, 1); assert.equal(f.c.g_iActionResultCount, 9)
})
check('plugin shutdown removes transport, periodic and deferred tasks', () => {
  const f = fixture(); for (const id of [32100, 32101, 32200]) f.tasks.set(id, {})
  f.c.plugin_end(); assert.equal(f.tasks.size, 0); assert.equal(f.c.g_iActiveSocket, 0); assert.equal(f.c.closed, 1)
})
check('numeric host gate avoids blocking DNS', () => {
  const f = fixture()
  for (const host of ['127.0.0.1', '192.168.1.7']) assert.equal(f.c.SyncNumericHost([...Buffer.from(host), 0]), true)
  for (const host of ['localhost', '127.0.0.999', '127.0.0.', '127.0.0.1.example']) assert.equal(f.c.SyncNumericHost([...Buffer.from(host), 0]), false)
})
check('whole-body boundary rejects trailing data even with a prefix-accepting JSON native', () => {
  const f = receiving()
  f.c.json_parse = a => {
    const s = text(a)
    for (let i = 1; i <= s.length; i++) { try { return JSON.parse(s.slice(0, i)) } catch {} }
    return -1
  }
  f.c.recv.push(http(good + '] trailing'), 0); f.poll()
  assert.equal(f.executed.length, 0); assert.equal(f.c.g_iActionResultCount, 1)
})
console.log(`${passed} passed; ${failed} failed (source-derived simulation, not AMXX runtime)`)
process.exitCode = failed ? 1 : 0
