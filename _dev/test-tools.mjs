/**
 * Contract smoke test for the agent tools.
 *
 * There are ~21 tools and none of them had a direct test: a typo in a handler
 * or a tool that throws on empty arguments would only surface when an agent
 * called it. This walks the whole registry with `{}` and asserts the shape of
 * every answer: a boolean `ok`, a machine-readable code on failure, never a
 * rejected promise.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { registerCatTools } from '../lib/tools.js'

const dataDir = mkdtempSync(join(tmpdir(), 'cait-tools-'))
const store = new CatStore({ dataDir })
const tools = []
const ctx = {
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
}

registerCatTools(ctx, store)

assert.ok(tools.length >= 20, `expected the full tool set, got ${tools.length}`)

const names = new Set()
for (const tool of tools) {
  assert.match(tool.name, /^cat_[a-z0-9_]+$/, `tool name ${tool.name} is not snake_case cat_*`)
  assert.ok(!names.has(tool.name), `duplicate tool name ${tool.name}`)
  names.add(tool.name)
  assert.ok(
    typeof tool.description === 'string' && tool.description.length > 30,
    `${tool.name} needs a real description`,
  )
  assert.equal(tool.parameters?.type, 'object', `${tool.name} needs an object schema`)
  assert.equal(typeof tool.execute, 'function', `${tool.name} needs execute`)
  const properties = Object.keys(tool.parameters.properties ?? {})
  for (const required of tool.parameters.required ?? []) {
    assert.ok(properties.includes(required), `${tool.name} requires undeclared ${required}`)
  }
}

for (const tool of tools) {
  const result = await tool.execute({})
  assert.equal(typeof result, 'object', `${tool.name} must resolve to an object`)
  assert.equal(typeof result.ok, 'boolean', `${tool.name} must report ok`)
  if (!result.ok) {
    assert.match(
      result.error ?? '',
      /^[A-Z][A-Z0-9_]+$/,
      `${tool.name} failure needs an uppercase code, got ${JSON.stringify(result)}`,
    )
    assert.ok(
      typeof result.message === 'string' && result.message.length > 0,
      `${tool.name} message`,
    )
  }
}

const getSegment = tools.find((tool) => tool.name === 'cat_get_segment')
const empty = await getSegment.execute({})
assert.equal(empty.ok, false)
assert.equal(empty.error, 'NO_DOCUMENT')

const created = store.createDocument({ name: 'tools.txt', text: '第一句。\n\n第二句。' })
const loaded = await getSegment.execute({ documentId: created.document.id })
assert.equal(loaded.ok, true, JSON.stringify(loaded))
assert.ok(loaded.segment?.source, 'cat_get_segment should return the current segment')

const submitted = await tools
  .find((tool) => tool.name === 'cat_submit_translation')
  .execute({ target: 'First sentence.', documentId: created.document.id })
assert.equal(submitted.ok, true, JSON.stringify(submitted))

const state = store.bootstrap()
assert.equal(state.activeDocument.segments[0].status, 'confirmed')
assert.equal(state.activeDocument.segments[0].target, 'First sentence.')

rmSync(dataDir, { recursive: true, force: true })
console.log(`ok  ${tools.length} tools registered, empty-argument contract holds`)
