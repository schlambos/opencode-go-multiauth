import type { ResolvedProfile } from "./config.js"
import { cloneDefaultModels, DEFAULT_MODELS } from "./models.js"

const PROBE_TIMEOUT_MS = 3000

async function timedFetch(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function getOrCreateRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const current = parent[key]
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>
  }
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

export async function buildProviderConfig(
  profile: ResolvedProfile,
): Promise<Record<string, unknown>> {
  let models = profile.models

  if (!models) {
    try {
      models = await fetchAndProbeModels(profile)
    } catch (e) {
      console.warn(`[opencode-go-multi-auth] Failed to dynamically fetch models for ${profile.id}:`, e)
      models = cloneDefaultModels()
      
      // Fallback: qwen models require the Anthropic messages format.
      const anthropicApi = profile.baseURL ? profile.baseURL.replace(/\/v1$/, '') + "/v1" : "https://opencode.ai/zen/go/v1"
      for (const [id, modelDef] of Object.entries(models)) {
        if (id.startsWith("qwen") && typeof modelDef === "object" && modelDef !== null) {
          ;(modelDef as Record<string, unknown>).provider = {
            npm: "@ai-sdk/anthropic",
            api: anthropicApi,
          }
        }
      }
    }
  }

  return {
    npm: "@ai-sdk/openai-compatible",
    name: profile.name,
    options: {
      apiKey: profile.apiKey,
      baseURL: profile.baseURL,
    },
    models,
  }
}

export async function injectProfiles(
  config: Record<string, unknown>,
  profiles: ResolvedProfile[],
): Promise<void> {
  const providers = getOrCreateRecord(config, "provider")

  for (const profile of profiles) {
    providers[profile.providerId] = await buildProviderConfig(profile)
  }
}

async function fetchAndProbeModels(profile: ResolvedProfile): Promise<Record<string, Record<string, unknown>>> {
  const baseUrl = profile.baseURL
  const modelsUrl = `${baseUrl.replace(/\/$/, '')}/models`
  
  const res = await timedFetch(modelsUrl, {
    headers: { 'Authorization': `Bearer ${profile.apiKey}` }
  }, PROBE_TIMEOUT_MS)
  
  if (!res.ok) {
    throw new Error(`Models fetch failed: ${res.status} ${res.statusText}`)
  }
  
  const data = await res.json() as { data?: { id: string }[] }
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Invalid models response format")
  }
  
  const discoveredModels = data.data.map(m => m.id)
  const anthropicApi = baseUrl.replace(/\/v1$/, '') + "/v1"

  // Build a model entry, applying the Anthropic override only when needed.
  const makeEntry = (modelId: string, format: 'oa-compat' | 'anthropic'): Record<string, unknown> => {
    const name = DEFAULT_MODELS.find(m => m.id === modelId)?.name || modelId
    const entry: Record<string, unknown> = { name }
    if (format === 'anthropic') {
      entry.provider = { npm: "@ai-sdk/anthropic", api: anthropicApi }
    }
    return entry
  }

  // Known models that require the Anthropic messages format. Used as the
  // default whenever a probe is inconclusive (e.g. times out at startup).
  const requiresAnthropic = (id: string) => id.startsWith("qwen")

  // Seed EVERY discovered model up front. Model visibility comes from the
  // /models endpoint, not from probe success — so a slow or aborted probe
  // never causes a model (or the whole provider) to disappear.
  const result: Record<string, Record<string, unknown>> = {}
  for (const modelId of discoveredModels) {
    result[modelId] = makeEntry(modelId, requiresAnthropic(modelId) ? 'anthropic' : 'oa-compat')
  }

  // Probe in parallel ONLY to refine the detected format. A failed/aborted
  // probe leaves the seeded default in place.
  const probes = discoveredModels.map(async (modelId) => {
    try {
      const oaRes = await timedFetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${profile.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'probe' }],
          max_tokens: 1
        })
      }, PROBE_TIMEOUT_MS)

      if (oaRes.ok) {
        return { id: modelId, format: 'oa-compat' as const }
      }

      const errText = await oaRes.text()
      if (errText.includes('not supported for format oa-compat')) {
        const antRes = await timedFetch(`${baseUrl.replace(/\/v1$/, '')}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': profile.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'probe' }],
            max_tokens: 1
          })
        }, PROBE_TIMEOUT_MS)

        if (antRes.ok) {
          return { id: modelId, format: 'anthropic' as const }
        }
      }
    } catch (e) {
      // Ignore network errors / aborts on individual probes; keep the default.
    }
    return { id: modelId, format: 'unknown' as const }
  })

  const probeResults = await Promise.all(probes)

  for (const pr of probeResults) {
    if (pr.format === 'unknown') continue // keep the seeded default
    result[pr.id] = makeEntry(pr.id, pr.format)
  }

  return result
}
