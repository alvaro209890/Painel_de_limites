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

export type RenameResult = { ok: boolean; machineId: string; name: string; checkedAt: string }

export async function renameMachine(machineId: string, name: string): Promise<RenameResult> {
  return apiFetch<RenameResult>(`/api/machines/${encodeURIComponent(machineId)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}
