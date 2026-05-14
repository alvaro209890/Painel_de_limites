export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = options.method || 'GET'
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'x-admin-action': '1' } : {}),
    ...((options.headers || {}) as Record<string, string>),
  }

  const response = await fetch(url, { ...options, method, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Falha na requisicao')
  return payload as T
}
