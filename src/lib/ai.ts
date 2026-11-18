/**
 * Optional AI briefing via the Claude API (user's own key). The desktop app sends
 * this from the Rust core (src-tauri/src/ai.rs); the web build sends the same
 * request straight from the browser, so the key never touches any server but Anthropic's.
 * Keep the two in step.
 */
export const AI_URL = 'https://api.anthropic.com/v1/messages';
export const AI_MODEL = 'claude-opus-5-5';

export const AI_SYSTEM =
  'You are a calm, factual local situational-awareness analyst for a neighborhood watch console. ' +
  'You receive a JSON snapshot of public data for one US city area: a stability index with its components, crime report ' +
  'counts by neighborhood, live alerts, hazards, infrastructure status and headlines. Write a short briefing for a resident: ' +
  '4 to 6 bullet points, each one sentence, most important first, then one line starting \'Watch for:\' with what to keep an ' +
  'eye on in the next few hours. Use only the data given; do not speculate about individuals, do not identify people, and do ' +
  'not encourage confronting anyone. Say when data is thin. Plain text, no markdown headings.';

export function aiRequest(key: string, snapshot: string): { url: string; init: RequestInit } {
  return {
    url: AI_URL,
    init: {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'x-api-key': key.trim(),
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
        // Required by the API for calls made from a web page. The key is the visitor's own and stays in their browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 4000,
        output_config: { effort: 'medium' },
        // Server-side refusal fallback: on a policy decline the API retries on a fallback model.
        fallbacks: 'default',
        system: AI_SYSTEM,
        messages: [{ role: 'user', content: `Current snapshot:\n${snapshot}` }],
      }),
    },
  };
}

interface AiResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  error?: { message?: string };
}

/** Same checks as ai.rs: API errors, refusals and empty answers become readable messages. */
export function aiResult(status: number, v: AiResponse): string {
  if (status < 200 || status >= 300) throw new Error(`Claude API ${status}: ${v.error?.message ?? 'unknown error'}`);
  if (v.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const text = (v.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
  if (!text.trim()) throw new Error(`empty response (stop_reason: ${v.stop_reason})`);
  return text;
}

export async function aiBriefBrowser(key: string, snapshot: string): Promise<string> {
  if (!key.trim()) throw new Error('no Claude API key');
  const { url, init } = aiRequest(key, snapshot);
  const res = await fetch(url, init);
  return aiResult(res.status, (await res.json().catch(() => ({}))) as AiResponse);
}
