import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

const pack = new URL('../contracts/s2a/', import.meta.url)
const readJson = async relative => JSON.parse(await readFile(new URL(relative, pack), 'utf8'))

const typeMatches = (value, type) => ({
  object: value !== null && typeof value === 'object' && !Array.isArray(value),
  array: Array.isArray(value),
  string: typeof value === 'string',
  integer: Number.isInteger(value),
  number: typeof value === 'number' && Number.isFinite(value),
  boolean: typeof value === 'boolean',
  null: value === null,
})[type] ?? true

function validate(value, schema, root = schema, path = '$') {
  if (schema.$ref) {
    const segments = schema.$ref.replace(/^#\//, '').split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    const resolved = segments.reduce((node, part) => node?.[part], root)
    return resolved ? validate(value, resolved, root, path) : [`${path}: unresolved ${schema.$ref}`]
  }
  if (schema.anyOf) {
    return schema.anyOf.some(option => validate(value, option, root, path).length === 0)
      ? []
      : [`${path}: does not match anyOf`]
  }

  const errors = []
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: wrong constant`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`)
  if (schema.type && !typeMatches(value, schema.type)) return [...errors, `${path}: expected ${schema.type}`]

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: too short`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: too long`)
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: pattern mismatch`)
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) errors.push(`${path}: invalid uuid`)
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${path}: invalid date-time`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: too few items`)
    value.forEach((item, index) => errors.push(...validate(item, schema.items ?? {}, root, `${path}[${index}]`)))
  } else if (value !== null && typeof value === 'object') {
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(`${path}.${required}: required`)
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(item, schema.properties[key], root, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected`)
    }
  }
  return errors
}

test('JavaScript validates the same S2A fixture acceptance matrix', async () => {
  const index = await readJson('fixtures/index.json')
  for (const fixtureCase of index.cases) {
    const [schema, fixture] = await Promise.all([
      readJson(`schemas/${fixtureCase.contract}.v1.schema.json`),
      readJson(`fixtures/${fixtureCase.file}`),
    ])
    const errors = validate(fixture, schema)
    assert.equal(errors.length === 0, fixtureCase.accepted, `${fixtureCase.id}: ${errors.join('; ')}`)
  }
})

test('generated client types expose every common contract', async () => {
  const types = await readFile(new URL('../contracts/s2a/types.ts', import.meta.url), 'utf8')
  for (const name of ['Principal', 'AuthReturnTarget', 'CommandEnvelope', 'ErrorEnvelope', 'WorkflowJob', 'WorkflowStep', 'ModelCallRecord', 'OutboxEvent', 'AuditEvent']) {
    assert.match(types, new RegExp(`export interface ${name} \\{`))
  }
})
