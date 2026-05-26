export const SUPPORTED_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.3-codex',
]

export const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]

export function canonicalModelId(model = '') {
  return String(model || '').split('/').pop() || SUPPORTED_MODELS[0]
}

export function isGeminiModel(model = '') {
  return GEMINI_MODELS.includes(canonicalModelId(model))
}

export function openAIModelsPayload(options = {}) {
  const legacyNow = typeof options === 'number' ? options : null
  const now = legacyNow || options.now || Math.floor(Date.now() / 1000)
  const includeGemini = legacyNow ? false : Boolean(options.includeGemini)
  const models = includeGemini ? [...SUPPORTED_MODELS, ...GEMINI_MODELS] : SUPPORTED_MODELS
  const data = models.map((id) => ({
    id,
    object: 'model',
    created: now,
    owned_by: 'painel-de-limites',
  }))
  return { object: 'list', data }
}

export function extractInstructions(messages = []) {
  return messages
    .filter((message) => message?.role === 'system')
    .map((message) => contentToText(message.content))
    .filter(Boolean)
    .join('\n\n')
}

export function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content == null ? '' : String(content)
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part?.type === 'text' || part?.type === 'input_text' || part?.type === 'output_text') return part.text || ''
      return ''
    })
    .join('')
}

export function chatMessagesToResponsesInput(messages = []) {
  const items = []
  for (const message of messages) {
    if (!message || message.role === 'system') continue
    if (message.role === 'user') {
      items.push({ role: 'user', content: contentToText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const text = contentToText(message.content)
      if (text) items.push({ role: 'assistant', content: text })
      for (const toolCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        const fn = toolCall?.function || {}
        const name = String(fn.name || '').trim()
        if (!name) continue
        const callId = String(toolCall.call_id || toolCall.id || `call_${items.length}`).trim()
        items.push({
          type: 'function_call',
          call_id: callId,
          name,
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {}),
        })
      }
      continue
    }
    if (message.role === 'tool') {
      const callId = String(message.tool_call_id || '').trim()
      if (!callId) continue
      items.push({ type: 'function_call_output', call_id: callId, output: contentToText(message.content) })
    }
  }
  return items
}

export function chatToolsToResponsesTools(tools = []) {
  const converted = []
  for (const tool of Array.isArray(tools) ? tools : []) {
    const fn = tool?.function || {}
    const name = String(fn.name || '').trim()
    if (!name) continue
    converted.push({
      type: 'function',
      name,
      description: fn.description || '',
      strict: false,
      parameters: fn.parameters || { type: 'object', properties: {} },
    })
  }
  return converted
}

export function normalizeReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'minimal') return 'low'
  if (normalized === 'max') return 'xhigh'
  if (['none', 'low', 'medium', 'high', 'xhigh'].includes(normalized)) return normalized
  return 'medium'
}

export function buildCodexResponsesPayload(body = {}, sessionId = '') {
  const model = canonicalModelId(body.model || SUPPORTED_MODELS[0])
  const tools = chatToolsToResponsesTools(body.tools)
  const payload = {
    model,
    instructions: extractInstructions(body.messages) || 'You are a helpful coding assistant.',
    input: chatMessagesToResponsesInput(body.messages),
    tools,
    store: false,
    stream: true,
    parallel_tool_calls: true,
    tool_choice: tools.length ? 'auto' : undefined,
    prompt_cache_key: sessionId || undefined,
    reasoning: { effort: normalizeReasoningEffort(body.reasoning_effort || body.reasoning?.effort), summary: 'auto' },
    include: [],
  }
  if (!tools.length) delete payload.tool_choice
  if (!sessionId) delete payload.prompt_cache_key
  return payload
}

export function chatCompletionChunk({ id, model, delta = {}, finishReason = null }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

export function chatCompletionPayload({ id, model, content = '', toolCalls = [], finishReason = 'stop' }) {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
  }
}


export function buildGeminiPrompt(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = message?.role || 'user'
      const text = contentToText(message?.content)
      if (!text) return ''
      if (role === 'system') return `System instructions:
${text}`
      if (role === 'assistant') return `Assistant:
${text}`
      if (role === 'tool') return `Tool result:
${text}`
      return `User:
${text}`
    })
    .filter(Boolean)
    .join('\n\n')
}
