import type { Plugin } from "@opencode-ai/plugin"
import type { ProfileConfig } from "./config.js"
import { resolveProfiles } from "./config.js"
import { injectProfiles } from "./provider.js"

function isProfilesConfig(value: unknown): value is { profiles: ProfileConfig[] } {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return Array.isArray(obj.profiles)
}

function readProfiles(
  options: Record<string, unknown> | undefined,
  configSection: unknown,
): ProfileConfig[] {
  if (options && isProfilesConfig(options)) {
    return options.profiles
  }
  if (isProfilesConfig(configSection)) {
    return configSection.profiles
  }
  return []
}

export const OpencodeGoMultiAuthPlugin: Plugin = async (_input, options) => {
  return {
    config: async (config) => {
      const root = config as Record<string, unknown>
      const configSection = root["opencodeGoMultiAuth"]
      const profilesInput = readProfiles(
        options as Record<string, unknown> | undefined,
        configSection,
      )

      if (profilesInput.length === 0) {
        console.warn(
          "[opencode-go-multi-auth] No profiles configured. " +
          "Add profiles via the 'opencodeGoMultiAuth' config key or plugin options.",
        )
        return
      }

      const { profiles: resolved, errors } = resolveProfiles(profilesInput)

      for (const err of errors) {
        console.error(`[opencode-go-multi-auth] ${err.message}`)
      }

      if (resolved.length === 0) {
        console.warn("[opencode-go-multi-auth] No valid profiles to register.")
        return
      }

      injectProfiles(root, resolved)
    },
  }
}

export default OpencodeGoMultiAuthPlugin
