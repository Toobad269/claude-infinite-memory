export type Memory = { name: string; summary: string; tags: string[]; saved: string; size: number }
export type Mode = 'sparsam' | 'normal' | 'aggressiv'
export type Settings = { mode: Mode; threshold: number; autoClean: boolean; dir: string }

declare module 'claude-code' {
  interface PluginState {
    'infinite-memory': { memories: Memory[]; settings: Settings; fill: number; pending: string[] }
  }
}
