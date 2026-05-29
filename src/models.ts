export const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"

export interface ModelEntry {
  id: string
  name: string
}

export const DEFAULT_MODELS: ModelEntry[] = [
  { id: "minimax-m2.7", name: "MiniMax M2.7" },
  { id: "minimax-m2.5", name: "MiniMax M2.5" },
  { id: "kimi-k2.5", name: "Kimi K2.5" },
  { id: "kimi-k2.6", name: "Kimi K2.6" },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
  { id: "mimo-v2.5", name: "MiMo V2.5" },
  { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
  { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
  { id: "glm-5", name: "GLM-5" },
  { id: "glm-5.1", name: "GLM-5.1" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
  { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
]

export function cloneDefaultModels(): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const model of DEFAULT_MODELS) {
    result[model.id] = { name: model.name }
  }
  return result
}
