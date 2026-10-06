# next-steps-desktop

After each turn, suggests up to three next prompts: above the input box in the terminal, behind a 💡 chip in the footer of Claude Code Desktop.

A fork of [`next-steps`](https://github.com/anthropics/claude-plugins-community/tree/87c843d52c12f4bc91bb23b47132eb08b70e6cb6/next-steps) (upstream commit `87c843d52c12f4bc91bb23b47132eb08b70e6cb6`, version 1.0.0, by Thariq Shihipar). The first commit of this repository is that upstream copy unchanged; the second holds every change. It adds a Desktop renderer and asks the fork for deeper suggestions; the rest of the suggestion logic is unchanged. It is renamed so it cannot clash with the upstream plugin.

```
next:
  1: run the tests you just wrote
  2: do the same for the settings page
  3: /code-review high
  0: dismiss
```

In the terminal press `1`, `2` or `3` from an empty prompt box; in Desktop press the 💡 chip in the footer and click anywhere on a row of the Next steps pane, or press `1`, `2` or `3` while the pane has the focus. That prompt is written into the box as a draft. The suggestions stay until the next turn starts or you dismiss them, so pressing another one replaces the draft. Edit it, then press Enter yourself. In the terminal `0` dismisses; on Desktop closing the pane hides the list and the chip opens it again. In the terminal the top suggestion also shows as the box's dim ghost text, so Tab takes it; Desktop shows no ghost text.

The plugin never submits a prompt on its own.

## Install

```
claude plugin marketplace add bqnhat/next-steps-desktop
claude plugin install next-steps-desktop@next-steps-desktop
```

New sessions load it, in the terminal and in the Desktop Code tab. For one terminal session only, without installing: `claude --plugin-dir <clone of this repository>`.

## How it works

It is a function-hooks plugin (`hooks/register.tsx`):

- `turn.complete`: forks the session with `$.model.fork` to ask for next prompts. The fork shares the session's prompt cache, so it costs about one short reply.
- The fork is asked for the prompts that move the person's goal forward most, not the most likely ones (upstream asks for the obvious next action, such as running the tests or committing). It draws them from what the last answer left unverified, risks and edge cases left unhandled, places where the same cause may recur, decisions left to the person and unfinished parts of the request. The three prompts cover different angles. Each names the exact file, command or data, what to find out or change, and how to tell it is done, in under 500 characters (a prompt is cut at 1200). Generic steps, work already done and anything the person's standing instructions rule out are excluded.
- `$.command.list`: the session's skills and slash commands (plugin, user and MCP ones with their descriptions) go into the fork's question, so a suggestion can be `/skill arguments`. A suggestion that names a command the session does not have is dropped.
- `ui.render` on `AbovePrompt` draws the terminal buttons. On Desktop, `SessionMode` draws the 💡 chip and `Pane` (`next-steps`) draws the list.
- A press calls `$.prompt.fill`; the top suggestion goes to `$.prompt.suggest`.
- `turn.start`: hides the suggestions and closes the pane.

## Surfaces

| Surface | What draws |
| --- | --- |
| `terminal` | The upstream tree, unchanged: `next:` and plain `1:` / `2:` / `3:` / `0: dismiss` buttons |
| `desktop` | Nothing above the prompt. A `💡 N` button (`next-steps-chip`) in the footer, only while suggestions are ready, opens or closes the Next steps pane. The chip is a plain label like the footer's own. The pane numbers each suggestion with a small badge; beside it the label is a plain button (`next-step-1` to `next-step-3`) over a one-line dim preview of its prompt (at most 160 characters, cut with `…` at the pane's edge), and the row lights under the pointer. Labels are cut with `…` to the pane's width, and the fork is asked for labels of at most 32 characters; a press still fills the whole prompt and keeps the list |
| `mobile`, `vscode` | Nothing: the engine raises `AbovePrompt` and `SessionMode` on the terminal and desktop surfaces only |

On Desktop a press goes through `$.prompt.fill`, which the engine routes to the Desktop composer (`ui_prompt_fill`), so the prompt lands in the composer as a draft and is not sent.

## Requirements

Function hooks are early access. An installed plugin's hooks module loads only while the engine's `tengu_plugin_hooks_modules` rollout is on for the session, or, on Claude Code builds that still read it (2.1.284), while `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is in the session's environment. Without either, the plugin installs but draws nothing.

In the Desktop Code tab the chip appears only when the Claude Code that Desktop bundles is 2.1.286 or later, whose sessions report the `ui_surface_v1` capability; with 2.1.284 nothing is drawn.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `minAnswerChars` | `80` | Skip suggestions after answers shorter than this |
| `suggestSkills` | `true` | Tell the suggester which skills and slash commands the session has |

## Tests

```
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
```

`tests/next-steps.test.tsx` mounts `AbovePrompt` on the `terminal` surface, and `SessionMode` and the `Pane` on `desktop`. It checks the buttons, the chip and the pane it opens, the numbered rows, the label cut and the prompt preview, the draft fill, dismiss in the terminal, the hide on a new turn, both options, fork failure and text cleaning.

## License

The upstream repository is licensed under the Apache License 2.0 (`LICENSE`, copied unchanged), while the upstream `plugin.json` declares `"license": "MIT"`; both are kept as they were. The changes are in the second commit.
