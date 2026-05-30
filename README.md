# opencode-go-multi-auth

OpenCode plugin that exposes multiple OpenCode Go subscription identities as separate, selectable providers — each backed by a different API key.

If you have more than one OpenCode Go account (personal, work, alt, etc.) and want to switch between them per-conversation in OpenCode without re-authenticating, this plugin gives you one `opencode-go-<id>/*` provider per account.

## Why this exists

OpenCode's stock OpenCode Go provider supports one API key at a time. This plugin registers N parallel providers, one per profile you define, each with its own `apiKey` pulled from an environment variable. At startup it fetches the live model list from each profile's endpoint and probes each model to determine its API format; models that use the openai-compatible format are registered normally, while models that require the Anthropic messages format get a per-model provider override. Pick the account by selecting the matching model namespace in OpenCode's model picker (e.g. `opencode-go-personal/glm-5` vs `opencode-go-alt/glm-5`).

## Install

```bash
git clone https://github.com/schlambos/opencode-go-multiauth.git
cd opencode-go-multiauth
npm install
npm run build
```

This produces `dist/index.js`, which is what OpenCode loads.

## Configuration

OpenCode loads plugins via the `plugin` field in `~/.config/opencode/opencode.jsonc`. **This plugin requires a thin local shim file** (see the next section) because of two limitations in current OpenCode releases:

1. **Custom top-level config keys are rejected.** Putting `"opencodeGoMultiAuth": { profiles: [...] }` directly in `opencode.jsonc` triggers `ConfigInvalidError` at startup — OpenCode validates against a fixed schema.
2. **Plugin options are not delivered at runtime.** The `[path, options]` tuple form is declared in OpenCode's schema and in `@opencode-ai/plugin`'s TypeScript types (`plugin?: Array<string | [string, PluginOptions]>`), but the runtime currently passes `options === undefined` to the plugin function.

The workaround is a shim file that invokes the plugin directly with hardcoded options. This is a one-time setup that takes about thirty seconds.

### Step 1 — create the shim

Save this as `~/.config/opencode/plugins/opencode-go-multi-auth.js`. Adjust the absolute path to wherever you cloned the repo:

```js
import plugin from "file:///absolute/path/to/opencode-go-multiauth/dist/index.js"

const profiles = [
  {
    id: "personal",
    name: "OpenCode Go Personal",
    apiKeyEnv: "OPENCODE_GO_PERSONAL_KEY",
  },
  {
    id: "alt",
    name: "OpenCode Go Alt",
    apiKeyEnv: "OPENCODE_GO_ALT_KEY",
  },
]

export default async function (input, _options) {
  return plugin(input, { profiles })
}
```

Files placed in `~/.config/opencode/plugins/` are auto-discovered — you do **not** need to add this path to the `plugin` array in `opencode.jsonc`. Adding it there causes OpenCode to try to npm-install the relative path and emit a spurious "unknown git error" in the log.

### Step 2 — export the API keys

The plugin reads each profile's API key from `process.env[apiKeyEnv]`. In your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export OPENCODE_GO_PERSONAL_KEY="oc_go_xxxxxxxx"
export OPENCODE_GO_ALT_KEY="oc_go_yyyyyyyy"
```

If an env var is missing at startup, the plugin skips that profile and logs a single line to stderr — it will not crash OpenCode.

### Step 3 — restart OpenCode

Run `opencode models` and confirm the new providers appear:

```
opencode-go-personal/glm-5
opencode-go-personal/kimi-k2.5
...
opencode-go-alt/glm-5
opencode-go-alt/kimi-k2.5
...
```

You can also reference them in your `opencode.jsonc`:

```jsonc
{
  "model": "opencode-go-personal/kimi-k2.5",
  "small_model": "opencode-go-alt/minimax-m2.7"
}
```

## Profile schema

| Field        | Required | Default                          | Description                                       |
|--------------|----------|----------------------------------|---------------------------------------------------|
| `id`         | yes      | —                                | Short identifier (lowercase, digits, hyphens)     |
| `name`       | yes      | —                                | Display name shown in OpenCode's model picker     |
| `apiKeyEnv`  | yes      | —                                | Env var holding the API key for this profile      |
| `providerId` | no       | `opencode-go-${id}`              | Override the generated provider ID                |
| `baseURL`    | no       | `https://opencode.ai/zen/go/v1`  | Override the upstream base URL                    |
| `models`     | no       | Live list fetched from `/models` | Override the model catalog for this profile; skips probing entirely  |

## Validation

The plugin runs the following checks at startup and reports each failure to stderr:

- Missing or empty `id`, `name`, or `apiKeyEnv`
- Duplicate `id`
- Duplicate generated `providerId`
- Malformed `id` or `providerId` (must match `^[a-z][a-z0-9-]*$`)
- Env var named by `apiKeyEnv` is unset or empty
- Empty profile list

A profile that fails any check is dropped; the rest still register. The plugin never throws during normal operation.

## Optional: JSON-driven shim

If you'd rather not edit JavaScript to add/remove accounts, point the shim at a JSON file:

```js
import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import plugin from "file:///absolute/path/to/opencode-go-multiauth/dist/index.js"

const CONFIG_PATH = join(homedir(), ".config", "opencode", "opencode-go.json")

function loadProfiles() {
  const data = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
  if (!Array.isArray(data.accounts)) return []
  return data.accounts
    .filter((a) => a && a.id && a.name && a.apiKeyEnv)
    .map((a) => ({ id: a.id, name: a.name, apiKeyEnv: a.apiKeyEnv }))
}

const profiles = loadProfiles()

export default async function (input, _options) {
  return plugin(input, { profiles })
}
```

…with `~/.config/opencode/opencode-go.json`:

```json
{
  "accounts": [
    { "id": "personal", "name": "OpenCode Go Personal", "apiKeyEnv": "OPENCODE_GO_PERSONAL_KEY" },
    { "id": "alt",      "name": "OpenCode Go Alt",      "apiKeyEnv": "OPENCODE_GO_ALT_KEY" }
  ]
}
```

This pattern lets other tools (e.g. a usage-monitor plugin) share the same account list.

## Security

- API keys are never logged, printed, or echoed by the plugin
- Error messages reference only the env var name, never its value
- Each registered provider holds its own `options.apiKey` — there is no shared mutable auth state between profiles
- When dynamic model probing is active (i.e. no static `models` override on a profile), the plugin makes outbound HTTP requests to the configured `baseURL` at startup: one `GET /models` and one `POST` probe per discovered model. These requests carry the profile's API key in an `Authorization` or `x-api-key` header. No keys or response data are written to disk or logged.

## Verifying the keys are actually distinct

If you want to confirm that two profiles really hit two different upstream accounts (rather than silently collapsing onto the same key), the simplest check is:

```bash
curl -sS -H "Authorization: Bearer $OPENCODE_GO_PERSONAL_KEY" https://opencode.ai/zen/go/v1/models | head -c 200
curl -sS -H "Authorization: Bearer $OPENCODE_GO_ALT_KEY"      https://opencode.ai/zen/go/v1/models | head -c 200
```

Both should return HTTP 200, and your OpenCode Go workspace dashboards (https://opencode.ai/workspace/<id>/go) should show divergent usage after you exercise each account.

## Build

```bash
npm install
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
```

The plugin has only `@opencode-ai/plugin` as a peer dependency; no runtime deps.

## Changelog

### 0.1.2 — 2026-05-30

**README accuracy fixes**

- Corrected "Why this exists" — removed the incorrect claim that all providers use `@ai-sdk/openai-compatible`; anthropic-format models get a per-model `@ai-sdk/anthropic` override since 0.1.1.
- Corrected profile schema `models` default — was "Built-in OpenCode Go model list"; now accurately states "Live list fetched from `/models`" with the static list as fallback, and notes that providing `models` skips probing.

### 0.1.1 — 2026-05-30

**Dynamic model enumeration with format detection**

- Added `fetchAndProbeModels()` in `src/provider.ts`. At startup the plugin now calls the `/models` endpoint for each profile to discover the live model list, then probes each model with a minimal request to determine whether it speaks the openai-compatible or anthropic API format. Probes run in parallel per profile.
- Models that respond correctly on the openai-compatible path are registered as normal. Models that fail with a format error are re-probed against the Anthropic messages endpoint; on success they are registered with a per-model `provider` override pointing at `@ai-sdk/anthropic`.
- Added `qwen3.7-max` to the static `DEFAULT_MODELS` list in `src/models.ts`.
- The fallback path (used when the `/models` fetch or any probe fails) now applies an anthropic provider override specifically for `qwen3.7-max` so it remains usable without a successful probe.
- Fixed a missing `await` on the `injectProfiles()` call in `src/index.ts`. Without it the async config mutation was fire-and-forget, meaning providers could silently fail to register if the probe network calls had not resolved before OpenCode finished reading the config.
- Updated `.gitignore` to exclude local probe and debug scripts (`probe.js`, `probe2.cjs`, `probe_anthropic.cjs`, `test-config.cjs`) and `schema.json`.

### 0.1.0 — 2026-05-29

**Initial release**

- Core plugin structure: `OpencodeGoMultiAuthPlugin` reads profiles from plugin options or the `opencodeGoMultiAuth` config key and injects one `@ai-sdk/openai-compatible` provider per resolved profile into the OpenCode config object.
- `src/config.ts`: profile resolution with full validation — checks for missing fields, duplicate IDs, malformed provider IDs, and unset env vars. Invalid profiles are dropped individually; the rest still register.
- `src/models.ts`: static `DEFAULT_MODELS` list covering the initial OpenCode Go model catalog (MiniMax, Kimi, MiMo, GLM, DeepSeek, Qwen families).
- `src/provider.ts`: `buildProviderConfig` and `injectProfiles` utilities that assemble the provider config shape expected by OpenCode.
- Shim-based setup documented to work around two current OpenCode limitations: rejection of unknown top-level config keys and missing plugin options delivery at runtime.
- Optional JSON-driven shim pattern documented for config-file-based account management.

## License

MIT — see [LICENSE](LICENSE).
