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
}

function world(on: On, reply: string | Error = SUGGESTIONS, gate?: Promise<void>): World {
  const w: World = {
    clock: mock.clock(on),
    forkPrompts: [],
    filled: [],
    suggested: [],
    submitted: [],
    logged: [],
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
  on('ui.toast', async () => ({ value: undefined }))
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

describe('desktop renderer', () => {
  test('draws the suggestions in one unwrapped row with a close control, no borders, label or hotkeys', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.key)).toEqual([
      'next-step-1',
      'next-step-2',
      'next-step-3',
      'next-steps-dismiss',
    ])
    expect(buttons.map(b => b.props.label)).toEqual(['Run the tests', 'Review it', 'Settings page', '✕'])
    expect(buttons.map(b => b.props.hotkey)).toEqual([undefined, undefined, undefined, undefined])
    expect(buttons.every(b => b.props.plain === true && b.props.dimColor === true)).toBe(true)
    const boxes = await ui.findAll({ type: 'Box' })
    expect(boxes.filter(box => box.props.borderStyle !== undefined)).toEqual([])
    const row = boxes.find(box => box.key === 'next-steps')
    expect(row?.props.flexWrap).toBe('nowrap')
    expect(row?.props.overflow).toBe('hidden')
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.map(t => t.text)).toEqual(['·', '·'])
    expect(texts.every(t => t.props.dimColor === true)).toBe(true)
    const kids = (row?.children ?? []) as { type?: string; props?: Record<string, unknown> }[]
    expect(kids[kids.length - 2]?.props?.flexGrow).toBe(1)
    expect(kids[kids.length - 1]?.props?.label).toBe('✕')
  })

  test('counts wide letters twice, so a Japanese label is cut to the same room', async ($, on) => {
    const w = world(on, JSON.stringify([{ label: '修正したファイルのテストを全部実行して結果を確認する', prompt: 'p' }, { label: 'Two', prompt: 'q' }, { label: 'Three', prompt: 'r' }]))
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

    expect((await ui.find({ type: 'Button', key: 'next-step-1' }))?.props.label).toBe('修正したファイルのテストを…')
  })

  test('cuts a label by code point, never inside a surrogate pair', async ($, on) => {
    const w = world(on, JSON.stringify([{ label: '𝐀'.repeat(40), prompt: 'p' }, { label: 'Two', prompt: 'q' }, { label: 'Three', prompt: 'r' }]))
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

    expect((await ui.find({ type: 'Button', key: 'next-step-1' }))?.props.label).toBe(`${'𝐀'.repeat(26)}…`)
  })

  test('cuts long labels to share one row, and a press still fills the whole prompt', async ($, on) => {
    const long = 'Trace why the chip test was not rebuilt after restart'
    const w = world(
      on,
      JSON.stringify([
        { label: long, prompt: 'first full prompt' },
        { label: long, prompt: 'second full prompt' },
        { label: long, prompt: 'third full prompt' },
      ]),
    )
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    const labels = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label)).slice(0, 3)
    expect(labels).toEqual(['Trace why the chip test wa…', 'Trace why the chip test wa…', 'Trace why the chip test wa…'])

    await ui.press({ key: 'next-step-2' })
    expect(w.filled).toEqual([{ text: 'second full prompt', mode: 'replace' }])
  })

  test('a narrow band still keeps a readable piece of each label', async ($, on) => {
    const w = world(
      on,
      JSON.stringify([
        { label: 'Trace why the chip test was not rebuilt', prompt: 'first' },
        { label: 'Two', prompt: 'second' },
        { label: 'Three', prompt: 'third' },
      ]),
    )
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { ...BAND_PROPS, bodyColumns: 20 },
    })

    expect((await ui.find({ type: 'Button', key: 'next-step-1' }))?.props.label).toBe('Trace why t…')
  })

  test('asks the fork for labels short enough to share one row', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('≤32 chars shown on a button')
  })

  test('a press puts the prompt in the composer as a draft, keeps the chips and never submits', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    await ui.press({ key: 'next-step-3' })
    await w.clock.settle()

    expect(w.filled).toEqual([{ text: 'do the same for the settings page', mode: 'replace' }])
    expect(w.submitted).toEqual([])
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  })

  test('pressing another chip before sending replaces the draft', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    await ui.press({ key: 'next-step-1' })
    await ui.press({ key: 'next-step-2' })
    await w.clock.settle()

    expect(w.filled).toEqual([
      { text: 'run the tests you just wrote', mode: 'replace' },
      { text: '/code-review high', mode: 'replace' },
    ])
    expect(w.submitted).toEqual([])

    await $.turn.start({ text: '/code-review high', turnId: 'turn-2' })
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test('dismiss hides the suggestions without filling', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    await ui.press({ key: 'next-steps-dismiss' })

    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(w.filled).toEqual([])
  })

  test('draws nothing while the fork is out', async ($, on) => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const w = world(on, SUGGESTIONS, held)
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()

    release()
    await w.clock.settle()
    await ui.redraw()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  })
})

describe('shared behaviour', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: a new turn hides the suggestions`, async ($, on) => {
      const w = world(on)
      await completeTurn($, w)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await ui.find({ type: 'Button' })).toBeDefined()

      await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })

      expect(await ui.find({ type: 'Button' })).toBeUndefined()
    })

    test(`${surface}: nothing is drawn while the model works or a survey holds the band`, async ($, on) => {
      const w = world(on)
      await completeTurn($, w)
      for (const props of [
        { ...BAND_PROPS, isWorking: true },
        { ...BAND_PROPS, hasSurvey: true },
      ]) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props })
        expect(await ui.find({ type: 'Button' })).toBeUndefined()
        await ui.unmount()
      }
    })
  }

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
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(w.logged.some(line => line.includes('fork failed'))).toBe(true)
  })

  test('a 900-character prompt is filled whole, with no ellipsis', async ($, on) => {
    const prompt = `${'abcd '.repeat(179)}abcde`
    expect(prompt).toHaveLength(900)
    const w = world(on, JSON.stringify([{ label: 'Long one', prompt }]))
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

    await ui.press({ key: 'next-step-1' })
    expect(w.filled).toEqual([{ text: prompt, mode: 'replace' }])
    expect(w.filled[0]?.text).not.toContain('…')
  })

  test('cleans escapes and controls, and refuses tag characters', async ($, on) => {
    const reply = JSON.stringify([
      { label: 'Clean\u001b[31m me​', prompt: 'run\u0007 the\n\ntests' },
      { label: 'Hidden', prompt: 'hello\u{E0041}' },
    ])
    const w = world(on, reply)
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.props.label)).toEqual(['Clean me', '✕'])
    await ui.press({ key: 'next-step-1' })
    expect(w.filled).toEqual([{ text: 'run the tests', mode: 'replace' }])
  })
})
