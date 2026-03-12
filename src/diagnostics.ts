export function logAuthState(context: string, payload: { activeSession: boolean; connectedAccounts: number; tokenAccounts: number; user?: string }): void {
  console.info(
    `[AUTH-STATE] context=${context} activeSession=${payload.activeSession} connected=${payload.connectedAccounts} tokenReady=${payload.tokenAccounts} user=${payload.user ?? 'n/a'}`
  );
}

export function logApiRequest(payload: { label: string; method: string; url: string; headers: Record<string, string> }): void {
  console.info(`[API-REQUEST] label=${payload.label} method=${payload.method} url=${payload.url} headers=${JSON.stringify(payload.headers)}`);
}

export function logApiResponse(payload: { label: string; statusCode: number; body: string }): void {
  console.info(`[API-RESPONSE] label=${payload.label} status=${payload.statusCode} body=${payload.body}`);
}

export function logRouting(payload: { from: string; to: string; method: string; statusCode?: number }): void {
  const status = payload.statusCode === undefined ? 'pending' : String(payload.statusCode);
  console.info(`[ROUTING] method=${payload.method} from=${payload.from} to=${payload.to} status=${status}`);
}

export function logWorkflow(payload: { event: string; itemId?: number; activeSession: boolean; detail?: string }): void {
  console.info(`[WORKFLOW] event=${payload.event} itemId=${payload.itemId ?? -1} activeSession=${payload.activeSession} detail=${payload.detail ?? ''}`);
}
