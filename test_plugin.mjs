// Validates the Claude Code plugin manifests and every shipped skill. Run: node --test test_plugin.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const plugin = json('.claude-plugin/plugin.json')
const market = json('.claude-plugin/marketplace.json')

test('plugin.json has the required fields', () => {
  assert.match(plugin.name, /^[a-z0-9-]+$/)
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/)
  assert.ok(plugin.description)
  assert.ok(plugin.author?.name)
})

test('marketplace.json lists this one plugin at ./', () => {
  assert.ok(market.name && market.owner?.name)
  assert.equal(market.plugins.length, 1)
  assert.equal(market.plugins[0].name, plugin.name)
  assert.equal(market.plugins[0].source, './')
})

test('every skill dir is listed, exists, and has valid frontmatter', () => {
  const dirs = readdirSync(join(root, 'skills')).sort()
  assert.deepEqual(plugin.skills.map((s) => s.replace(/^\.\/skills\//, '')).sort(), dirs)
  for (const d of dirs) {
    const f = join(root, 'skills', d, 'SKILL.md')
    assert.ok(existsSync(f), f)
    const m = readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(m, `${d}: no frontmatter`)
    const fm = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]))
    assert.equal(fm.name, d)
    assert.ok(fm.description, `${d}: no description`)
  }
})
