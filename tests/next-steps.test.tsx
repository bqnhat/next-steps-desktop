import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const PLUGIN = 'next-steps-desktop'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const LONG_ANSWER = 'The change is in place and the tests pass. '.repeat(3)

const SUGGESTIONS = JSON.stringify([
  { label: 'Run the tests', prompt: 'run the tests you just wrote' },
  { label: 'Review it', prompt: '/code-review high' },
  { label: 'Unknown command', prompt: '/no-such-command now' },
  { label: 'Settings page', prompt: 'do the same for the settings page' },
  { label: 'Fourth one', prompt: 'this one is past the limit' },
])

type World = {
  clock: MockClock
  forkPrompts: string[]
  filled: { text: string; mode: string }[]
  suggested: string[]
  submitted: string[]
  logged: string[]
  panes: Set<string>
  opened: { id: string; title?: string }[]
  behind: Set<string>
  unplaced: string
  toasts: string[]
  paneReads: number
  beforeClose: (() => Promise<void>) | null
}

function world(on: On, reply: string | Error = SUGGESTIONS, gate?: Promise<void>): World {
  const w: World = {
    clock: mock.clock(on),
    forkPrompts: [],
    filled: [],
    suggested: [],
    submitted: [],
    logged: [],
    panes: new Set(),
    opened: [],
    behind: new Set(),
    unplaced: '',
    toasts: [],
    paneReads: 0,
    beforeClose: null,
  }
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('command.list', async () => ({
    value: [
      { name: 'code-review', description: 'Review the current diff', source: 'plugin' as const },
      { name: 'clear', description: 'Clear the conversation', source: 'builtin' as const },
    ],
  }))
  on('model.fork', async (_$, e) => {
    w.forkPrompts.push(e.prompt)
    await gate
    if (reply instanceof Error) throw reply
    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  on('prompt.fill', async (_$, e) => {
    w.filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.suggest', async (_$, e) => {
    w.suggested.push(e.text)
    return { isShown: true }
  })
  on('prompt.submit', async (_$, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.log', async (_$, e) => {
    w.logged.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', async (_$, e) => {
    w.panes.add(e.id)
    w.opened.push({ id: e.id, title: e.title })
    return { value: w.unplaced === '' ? { isPlaced: true as const } : { isPlaced: false as const, reason: w.unplaced } }
  })
  on('ui.close', async (_$, e) => {
    await w.beforeClose?.()
    w.panes.delete(e.id)
    w.behind.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', async () => {
    w.paneReads += 1
    return { value: [...w.panes].map(id => ({ id, title: id, isShown: !w.behind.has(id), isFocused: false, isPlaced: w.unplaced === '' })) }
  })
  on('ui.render', async () => <></>)
  return w
}

async function completeTurn($: Engine, w: World, answer = LONG_ANSWER, turnId = 'turn-1') {
  await $.turn.complete({
    reason: 'answer',
    answer,
    durationMs: 1,
    isAborted: false,
    turnId,
  })
  await w.clock.settle()
}

describe('terminal renderer', () => {
  test('offers at most three known suggestions as 1/2/3 buttons and fills a draft', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.props.label)).toEqual([
      'Run the tests',
      'Review it',
      'Settings page',
      'dismiss',
    ])
    expect(buttons.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '0'])
    expect(await ui.find({ type: 'Text', text: 'next:' })).toBeDefined()
    expect(w.suggested).toEqual(['run the tests you just wrote'])

    await ui.press({ key: 'Review it' })
    expect(w.filled).toEqual([{ text: '/code-review high', mode: 'replace' }])
    expect(w.submitted).toEqual([])
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  })
})

const PANE_PROPS = {
  title: 'Next steps',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const pane = ($: Engine, bodyColumns = 40) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'next-steps', props: { ...PANE_PROPS, bodyColumns } })

const footer = ($: Engine, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: [] } })

async function labels(ui: { findAll: (q: { type: 'Text' }) => Promise<{ key?: string; text?: string }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).filter((_, i) => i % 3 === 1).map(t => String(t.text))
}

async function chipLabel($: Engine, surface: 'desktop' | 'terminal' = 'desktop'): Promise<unknown> {
  const ui = await footer($, surface)
  const chip = await ui.find({ type: 'Button', key: 'next-steps-chip' })
  await ui.unmount()
  return chip?.props.label
}

async function pressChip($: Engine) {
  const ui = await footer($)
  await ui.press({ key: 'next-steps-chip' })
  await ui.unmount()
}

describe('desktop renderer', () => {
  test('draws nothing above the prompt', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test('a 💡 chip in the footer counts the suggestions, and only while there are some', async ($, on) => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const w = world(on, SUGGESTIONS, held)
    expect(await chipLabel($)).toBeUndefined()

    await completeTurn($, w)
    expect(await chipLabel($)).toBeUndefined()

    release()
    await w.clock.settle()
    expect(await chipLabel($)).toBe('💡 3')
    expect(await chipLabel($, 'terminal')).toBeUndefined()
  })

  test('the chip sits before the footer drawn beneath it, which stays when there is no chip', async ($, on) => {
    on('ui.render', { component: 'SessionMode' }, async ($$, e) => {
      const { Text } = $$.ui.resolve(e)
      return <Text>focus</Text>
    })
    const w = world(on)
    for (const surface of ['desktop', 'terminal'] as const) {
      const bare = await footer($, surface)
      expect(await bare.find({ type: 'Text', text: 'focus' })).toBeDefined()
      await bare.unmount()
    }

    await completeTurn($, w)
    const ui = await footer($)
    const row = (await ui.drawn()) as { children?: { type?: string; props?: { key?: string } }[] }
    expect((row.children ?? []).map(kid => kid.props?.key ?? kid.type)).toEqual(['next-steps-chip', 'Text'])
    await ui.unmount()
    const terminal = await footer($, 'terminal')
    expect(await terminal.find({ type: 'Text', text: 'focus' })).toBeDefined()
  })

  test('a footer already on screen gains the chip when the suggestions arrive and loses it on the next turn', async ($, on) => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const w = world(on, JSON.stringify([{ label: 'Only one', prompt: 'p' }]), held)
    const ui = await footer($)
    await completeTurn($, w)
    expect(await ui.find({ type: 'Button', key: 'next-steps-chip' })).toBeUndefined()

    release()
    await w.clock.settle()
    expect((await ui.find({ type: 'Button', key: 'next-steps-chip' }))?.props.label).toBe('💡 1')

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })
    expect(await ui.find({ type: 'Button', key: 'next-steps-chip' })).toBeUndefined()
  })

  test('the chip brings the pane forward when another pane covers it, by closing and opening it afresh', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    await pressChip($)
    w.behind.add('next-steps')

    await pressChip($)
    expect([...w.panes]).toEqual(['next-steps'])
    expect(w.opened).toHaveLength(2)
    expect(w.behind.has('next-steps')).toBe(false)
  })

  test('the chip is a plain footer label, like the labels beside it', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await footer($)

    expect((await ui.find({ type: 'Button', key: 'next-steps-chip' }))?.props.plain).toBe(true)
  })

  test('says why when the surface does not place the pane', async ($, on) => {
    const w = world(on)
    w.unplaced = 'no attached surface places panes'
    await completeTurn($, w)
    await pressChip($)

    expect(w.toasts).toEqual(['no attached surface places panes'])
  })

  test('a pane left without suggestions closes at the next session start', async ($, on) => {
    const w = world(on)
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    w.panes.add('next-steps')
    await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
    expect([...w.panes]).toEqual([])
  })

  test('pressing the chip opens the Next steps pane, and pressing it again closes it', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    await pressChip($)
    expect(w.opened).toEqual([{ id: 'next-steps', title: 'Next steps' }])
    expect([...w.panes]).toEqual(['next-steps'])

    await pressChip($)
    expect([...w.panes]).toEqual([])
  })

  test('the pane numbers each suggestion over a one-line preview; a press fills the draft and keeps the list', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await pane($)

    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.key)).toEqual(['next-step-1', 'next-step-2', 'next-step-3'])
    expect(buttons.every(b => b.props.hotkey === undefined && b.props.label === ' '.repeat(110))).toBe(true)
    expect((await ui.findAll({ type: 'Text' })).filter((_, i) => i % 3 === 0).map(t => t.text)).toEqual(['1', '2', '3'])
    expect(await labels(ui)).toEqual(['Run the tests', 'Review it', 'Settings page'])
    expect((await ui.find({ type: 'Box', key: 'next-step-hit-2' }))?.props).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'stretch' })
    expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    expect((await ui.findAll({ type: 'Text' })).filter((_, i) => i % 3 === 2).map(t => [t.text, t.props.wrap])).toEqual([
      ['run the tests you just wrote', 'truncate'],
      ['/code-review high', 'truncate'],
      ['do the same for the settings page', 'truncate'],
    ])

    await ui.press({ key: 'next-step-2' })
    await ui.press({ key: 'next-step-1' })
    await w.clock.settle()
    expect(w.filled).toEqual([
      { text: '/code-review high', mode: 'replace' },
      { text: 'run the tests you just wrote', mode: 'replace' },
    ])
    expect(w.submitted).toEqual([])
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
  })

  test('a long prompt shows a capped preview, and a press still fills the whole prompt', async ($, on) => {
    const prompt = `${'abcd '.repeat(179)}abcde`
    expect(prompt).toHaveLength(900)
    const w = world(on, JSON.stringify([{ label: 'Long one', prompt }]))
    await completeTurn($, w)
    const ui = await pane($)

    const preview = String((await ui.findAll({ type: 'Text' }))[2]?.text)
    expect([...preview]).toHaveLength(160)
    expect(preview.endsWith('…')).toBe(true)
    await ui.press({ key: 'next-step-1' })
    expect(w.filled).toEqual([{ text: prompt, mode: 'replace' }])
  })

  test('counts wide letters twice, so a Japanese label is cut to the pane width', async ($, on) => {
    const w = world(on, JSON.stringify([{ label: '修正したファイルのテストを全部実行して結果を確認する', prompt: 'p' }]))
    await completeTurn($, w)
    const ui = await pane($, 26)

    expect((await labels(ui))[0]).toBe('修正したファイル…')
  })

  test('cuts a label by code point, never inside a surrogate pair', async ($, on) => {
    const w = world(on, JSON.stringify([{ label: '𝐀'.repeat(40), prompt: 'p' }]))
    await completeTurn($, w)
    const ui = await pane($, 26)

    expect((await labels(ui))[0]).toBe(`${'𝐀'.repeat(17)}…`)
  })

  test('a very narrow pane still keeps a readable piece of each label', async ($, on) => {
    const w = world(on, JSON.stringify([{ label: 'Trace why the chip test was not rebuilt', prompt: 'first' }]))
    await completeTurn($, w)
    const ui = await pane($, 4)

    expect((await labels(ui))[0]).toBe('Trace why t…')
  })

  test('the suggestions are kept in the session state, so a reload of the plugin keeps them', async ($, on) => {
    const saved: unknown[] = []
    const w = world(on)
    on('state.set', async (_$, e, next) => {
      if ((e as { key?: string }).key === 'view') saved.push((e as { value?: unknown }).value)
      return next(e)
    })
    await completeTurn($, w)
    expect(saved.at(-1)).toMatchObject({ kind: 'offer', items: [{ label: 'Run the tests' }, { label: 'Review it' }, { label: 'Settings page' }] })

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })
    expect(saved.at(-1)).toEqual({ kind: 'hidden' })
  })

  test('asks the fork for short button labels', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('≤32 chars shown on a button')
  })

  test('a turn that never opened the pane does not ask for panes', async ($, on) => {
    const w = world(on)
    await $.turn.start({ text: 'first', turnId: 'turn-1' })
    const reads = w.paneReads
    await completeTurn($, w)
    await $.turn.start({ text: 'second', turnId: 'turn-2' })
    await $.turn.start({ text: 'third', turnId: 'turn-3' })

    expect(reads).toBeLessThanOrEqual(1)
    expect(w.paneReads).toBe(reads)
  })

  test('a turn closes the pane before it clears the list, so the pane never redraws empty', async ($, on) => {
    const seen: string[] = []
    const w = world(on)
    await completeTurn($, w)
    await pressChip($)
    w.beforeClose = async () => {
      const ui = await pane($)
      seen.push((await ui.find({ type: 'Button', key: 'next-step-1' })) ? 'list' : 'empty')
      await ui.unmount()
    }
    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })

    expect(seen).toEqual(['list'])
  })

  test('a pane opened after a turn found none is still closed by the next turn', async ($, on) => {
    const w = world(on)
    await $.turn.start({ text: 'first', turnId: 'turn-0' })
    await completeTurn($, w)
    await pressChip($)
    expect([...w.panes]).toEqual(['next-steps'])

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })
    expect([...w.panes]).toEqual([])
  })

  test('a new turn hides the chip and closes the pane', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    await pressChip($)

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })

    expect([...w.panes]).toEqual([])
    expect(await chipLabel($)).toBeUndefined()
  })
})

describe('shared behaviour', () => {
  test('terminal: a new turn hides the suggestions', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Button' })).toBeDefined()

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })

    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test('terminal: nothing is drawn while the model works or a survey holds the band', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    for (const props of [
      { ...BAND_PROPS, isWorking: true },
      { ...BAND_PROPS, hasSurvey: true },
    ]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('skips answers shorter than minAnswerChars', { options: { minAnswerChars: 500 } }, async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts).toEqual([])
  })

  test('lists plugin commands for the fork and leaves builtins out', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts).toHaveLength(1)
    expect(w.forkPrompts[0]).toContain('<available-skills>')
    expect(w.forkPrompts[0]).toContain('/code-review: Review the current diff')
    expect(w.forkPrompts[0]).not.toContain('/clear')
  })

  test('asks the fork for the prompts worth sending, not the most likely ones', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('not the ones that are merely the most likely')
    expect(w.forkPrompts[0]).toContain('left unverified')
    expect(w.forkPrompts[0]).toContain('how to tell it is done')
    expect(w.forkPrompts[0]).toContain('under 500 characters')
    expect(w.forkPrompts[0]).not.toContain('Prefer the obvious next action')
  })

  test('suggestSkills false keeps the command list out of the fork', { options: { suggestSkills: false } }, async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts).toHaveLength(1)
    expect(w.forkPrompts[0]).not.toContain('<available-skills>')
  })

  test('a failed fork logs and shows nothing', async ($, on) => {
    const w = world(on, new Error('boom'))
    await completeTurn($, w)

    expect(await chipLabel($)).toBeUndefined()
    expect(w.logged.some(line => line.includes('fork failed'))).toBe(true)
  })

  test('cleans escapes and controls, and refuses tag characters', async ($, on) => {
    const reply = JSON.stringify([
      { label: 'Clean\u001b[31m me​', prompt: 'run\u0007 the\n\ntests' },
      { label: 'Hidden', prompt: 'hello\u{E0041}' },
    ])
    const w = world(on, reply)
    await completeTurn($, w)
    const ui = await pane($)

    expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
    expect(await labels(ui)).toEqual(['Clean me'])
    await ui.press({ key: 'next-step-1' })
    expect(w.filled).toEqual([{ text: 'run the tests', mode: 'replace' }])
  })
})
