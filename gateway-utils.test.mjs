import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCodexResponsesPayload,
  buildGeminiPrompt,
  chatMessagesToResponsesInput,
  chatToolsToResponsesTools,
  isGeminiModel,
  normalizeReasoningEffort,
  openAIModelsPayload,
  SUPPORTED_MODELS,
} from './gateway-utils.mjs'

test('models payload exposes all 3 supported models', () => {
  const payload = openAIModelsPayload(123)
  const ids = payload.data.map((m) => m.id)
  assert.deepStrictEqual(ids, ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex'])
  assert.equal(payload.object, 'list')
})

test('models payload exposes Gemini only when explicitly enabled', () => {
  const withoutGemini = openAIModelsPayload({ now: 123 })
  assert.equal(withoutGemini.data.some((m) => m.id === 'gemini-2.5-flash'), false)

  const withGemini = openAIModelsPayload({ now: 123, includeGemini: true })
  const ids = withGemini.data.map((m) => m.id)
  assert.equal(ids.includes('gemini-2.5-pro'), true)
  assert.equal(ids.includes('gemini-2.5-flash'), true)
  assert.equal(ids.includes('gemini-2.5-flash-lite'), true)
})


test('supports reasoning_effort and reasoning.effort from both OpenCode and chat-compat clients', () => {
  const p1 = buildCodexResponsesPayload({ reasoning_effort: 'minimal', messages: [{ role: 'user', content: 'oi' }] })
  assert.equal(p1.reasoning.effort, 'low')
  const p2 = buildCodexResponsesPayload({ reasoning: { effort: 'max' }, messages: [{ role: 'user', content: 'oi' }] })
  assert.equal(p2.reasoning.effort, 'xhigh')
})

test('converts chat messages and tool results to Codex Responses input', () => {
  const input = chatMessagesToResponsesInput([
    { role: 'system', content: 'ignored here' },
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'vou chamar ferramenta', tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'conteudo' },
  ])
  assert.deepEqual(input, [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'vou chamar ferramenta' },
    { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'conteudo' },
  ])
})

test('converts OpenAI chat tools to Responses function tools', () => {
  assert.deepEqual(chatToolsToResponsesTools([{ type: 'function', function: { name: 'x', description: 'd', parameters: { type: 'object' } } }]), [
    { type: 'function', name: 'x', description: 'd', strict: false, parameters: { type: 'object' } },
  ])
})

test('builds a streaming Codex payload with safe reasoning effort mapping', () => {
  const payload = buildCodexResponsesPayload({
    model: 'limites/gpt-5.5',
    reasoning_effort: 'minimal',
    messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
  }, 'sessao')
  assert.equal(payload.model, 'gpt-5.5')
  assert.equal(payload.instructions, 's')
  assert.equal(payload.reasoning.effort, 'low')
  assert.equal(payload.stream, true)
  assert.equal(payload.prompt_cache_key, 'sessao')
})

test('normalizes max reasoning to Codex xhigh', () => {
  assert.equal(normalizeReasoningEffort('max'), 'xhigh')
})


test('detects Gemini model IDs with or without provider prefix', () => {
  assert.equal(isGeminiModel('limites-gemini/gemini-2.5-flash'), true)
  assert.equal(isGeminiModel('limites/gpt-5.5'), false)
})

test('builds Gemini CLI prompt from chat messages', () => {
  const prompt = buildGeminiPrompt([
    { role: 'system', content: 'seja breve' },
    { role: 'user', content: 'oi' },
  ])
  assert.equal(prompt.includes('System instructions:\nseja breve'), true)
  assert.equal(prompt.includes('User:\noi'), true)
})
