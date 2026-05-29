import { DEFAULT_BASE_URL } from "./models.js"

export interface ProfileConfig {
  id: string
  name: string
  apiKeyEnv: string
  providerId?: string
  baseURL?: string
  models?: Record<string, Record<string, unknown>>
}

export interface ResolvedProfile {
  id: string
  providerId: string
  name: string
  baseURL: string
  apiKeyEnv: string
  apiKey: string
  models?: Record<string, Record<string, unknown>>
}

export interface ConfigError {
  message: string
}

const PROVIDER_ID_RE = /^[a-z][a-z0-9-]*$/

function isValidProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id)
}

export function resolveProfiles(input: ProfileConfig[]): {
  profiles: ResolvedProfile[]
  errors: ConfigError[]
} {
  const errors: ConfigError[] = []
  const seenIds = new Set<string>()
  const seenProviderIds = new Set<string>()
  const resolved: ResolvedProfile[] = []

  if (!input || input.length === 0) {
    errors.push({ message: "Profile list is empty" })
    return { profiles: [], errors }
  }

  for (const profile of input) {
    if (!profile.id || typeof profile.id !== "string" || profile.id.trim() === "") {
      errors.push({ message: "A profile is missing the required 'id' field" })
      continue
    }

    const id = profile.id.trim()

    if (seenIds.has(id)) {
      errors.push({ message: `Duplicate profile id: "${id}"` })
      continue
    }
    seenIds.add(id)

    if (!profile.name || typeof profile.name !== "string" || profile.name.trim() === "") {
      errors.push({ message: `Profile "${id}" is missing the required 'name' field` })
      continue
    }

    const name = profile.name.trim()

    if (!profile.apiKeyEnv || typeof profile.apiKeyEnv !== "string" || profile.apiKeyEnv.trim() === "") {
      errors.push({ message: `Profile "${id}" is missing the required 'apiKeyEnv' field` })
      continue
    }

    const apiKeyEnv = profile.apiKeyEnv.trim()

    let providerId: string
    if (profile.providerId) {
      providerId = profile.providerId.trim()
      if (!isValidProviderId(providerId)) {
        errors.push({
          message: `Profile "${id}" has malformed providerId "${providerId}". Must start with a letter and contain only lowercase letters, digits, and hyphens.`,
        })
        continue
      }
    } else {
      providerId = `opencode-go-${id}`
      if (!isValidProviderId(providerId)) {
        errors.push({
          message: `Profile "${id}" generated invalid providerId "${providerId}". Profile id must start with a letter and contain only lowercase letters, digits, and hyphens.`,
        })
        continue
      }
    }

    if (seenProviderIds.has(providerId)) {
      errors.push({ message: `Duplicate provider id "${providerId}" from profile "${id}"` })
      continue
    }
    seenProviderIds.add(providerId)

    const baseURL = profile.baseURL?.trim() || DEFAULT_BASE_URL

    const apiKey = process.env[apiKeyEnv]
    if (!apiKey) {
      errors.push({
        message: `Profile "${id}": environment variable "${apiKeyEnv}" is not set or is empty. Profile will not be available.`,
      })
      continue
    }

    resolved.push({
      id,
      providerId,
      name,
      baseURL,
      apiKeyEnv,
      apiKey,
      models: profile.models,
    })
  }

  return { profiles: resolved, errors }
}
