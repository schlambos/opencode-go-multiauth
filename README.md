# opencode-go-multi-auth

OpenCode plugin that exposes multiple OpenCode Go subscription identities as separate, selectable providers — each backed by a different API key.

If you have more than one OpenCode Go account (personal, work, alt, etc.) and want to switch between them per-conversation in OpenCode without re-authenticating, this plugin gives you one `opencode-go-<id>/*` provider per account.

## Why this exists

OpenCode's stock OpenCode Go provider supports one API key at a time. This plugin registers N parallel `@ai-sdk/openai-compatible` providers, one per profile you define, each with its own `apiKey` pulled from an environment variable. Pick the account by selecting the matching model namespace in OpenCode's model picker (e.g. `opencode-go-personal/glm-5` vs `opencode-go-alt/glm-5`).

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
| `models`     | no       | Built-in OpenCode Go model list  | Override the model catalog for this profile       |

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
- The plugin does no network I/O of its own; it only mutates the in-memory config OpenCode passes to it

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

## License

MIT — see [LICENSE](LICENSE).
