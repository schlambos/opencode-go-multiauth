import type { ResolvedProfile } from "./config.js"
import { cloneDefaultModels } from "./models.js"

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

export function buildProviderConfig(
  profile: ResolvedProfile,
): Record<string, unknown> {
  const models = profile.models ?? cloneDefaultModels()

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

export function injectProfiles(
  config: Record<string, unknown>,
  profiles: ResolvedProfile[],
): void {
  const providers = getOrCreateRecord(config, "provider")

  for (const profile of profiles) {
    providers[profile.providerId] = buildProviderConfig(profile)
  }
}
