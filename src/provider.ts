import type { ResolvedProfile } from "./config.js"
import { cloneDefaultModels, DEFAULT_MODELS } from "./models.js"

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
      
      // Fallback: manually override provider for qwen3.7-max
      for (const [id, modelDef] of Object.entries(models)) {
        if (id === "qwen3.7-max") {
          if (typeof modelDef === "object" && modelDef !== null) {
            ;(modelDef as Record<string, unknown>).provider = {
              npm: "@ai-sdk/anthropic",
              api: profile.baseURL ? profile.baseURL.replace(/\/v1$/, '') + "/v1" : "https://opencode.ai/zen/go/v1",
            }
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
  
  const res = await fetch(modelsUrl, {
    headers: { 'Authorization': `Bearer ${profile.apiKey}` }
  })
  
  if (!res.ok) {
    throw new Error(`Models fetch failed: ${res.status} ${res.statusText}`)
  }
  
  const data = await res.json() as { data?: { id: string }[] }
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Invalid models response format")
  }
  
  const discoveredModels = data.data.map(m => m.id)
  const result: Record<string, Record<string, unknown>> = {}
  
  // Probe in parallel
  const probes = discoveredModels.map(async (modelId) => {
    // Try openai-compatible first
    try {
      const oaRes = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
      })
      
      if (oaRes.ok) {
        // Works with oa-compat
        return { id: modelId, format: 'oa-compat' }
      }
      
      const errText = await oaRes.text()
      if (errText.includes('not supported for format oa-compat')) {
        // Try anthropic format
        const antRes = await fetch(`${baseUrl.replace(/\/v1$/, '')}/v1/messages`, {
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
        })
        
        if (antRes.ok) {
          return { id: modelId, format: 'anthropic' }
        }
      }
    } catch (e) {
      // Ignore network errors on individual probes
    }
    return { id: modelId, format: 'unsupported' }
  })
  
  const probeResults = await Promise.all(probes)
  
  for (const pr of probeResults) {
    if (pr.format === 'unsupported') continue;
    
    const defaultName = DEFAULT_MODELS.find(m => m.id === pr.id)?.name || pr.id;
    const modelDef: Record<string, unknown> = { name: defaultName }
    if (pr.format === 'anthropic') {
      modelDef.provider = {
        npm: "@ai-sdk/anthropic",
        api: profile.baseURL.replace(/\/v1$/, '') + "/v1",
      }
    }
    result[pr.id] = modelDef
  }
  
  return result
}
