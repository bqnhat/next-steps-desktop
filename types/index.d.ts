export type Suggestion = { label: string; prompt: string }

export type View = { kind: 'hidden' } | { kind: 'loading'; turnId: string } | { kind: 'offer'; items: Suggestion[] }

declare module 'claude-code' {
  interface PluginState {
    'next-steps-desktop': {
      view: View
    }
  }
}
