# dsh-anti-defensive-writing

Anti-defensive writing for DeepSeek Harness: the Press-Release Principle as a skill, an offline defensive-writing detector, a `/adw` command, an optional `adw_scan` model tool, and a writing-health dashboard.

## What it registers

| Layer | Surface | Entry |
|---|---|---|
| Skill provider | `anti-defensive-writing` (zh) + `anti-defensive-writing-en` | `lib/skill-provider.js`, content from `skills/` (verbatim upstream, MIT) |
| Slash command | `/adw scan\|rules\|version\|on\|off` | `lib/command.js` |
| Model tool | `adw_scan` (optional, `tools: false` disables) | `lib/tool.js` |
| Prompt section | `dsh-adw:writing-discipline` (optional, `injectPrompt: false` disables) | `lib/index.js` |
| Projection | `adwWriting` | `lib/projection.js` |
| Client tab | right sidebar 「写作健康」 | `lib/client.js` (`id: 'dsh-adw'`, `kind: 'adw-writing-health'`) |
| Client settings | 「反防御性写作」section | `lib/client.js` (`id: 'anti-defensive-writing'`, `order: 12`) |

## Config

```yaml
- id: anti-defensive-writing
  name: dsh-anti-defensive-writing
  config:
    enabled: true           # master switch
    injectPrompt: true      # register the short system-prompt section
    tools: true             # register the model-facing adw_scan tool
    minSeverity: low        # high | medium | low
    disabledRules: []
    skillLanguage: zh       # zh | en (both are always advertised; this orders them)
```

## Development

```bash
node scripts/sync-detector.mjs          # copy packages/detector/lib into lib/detector/
node --test test/*.test.js              # package tests
node ../../scripts/verify.mjs           # everything, including a real DSH profile probe
```

`lib/detector/` is generated. Edit `packages/detector/` and re-run the sync; `node scripts/sync-detector.mjs --check` fails when the copy is stale.

## License

MIT. `skills/` and `prompts/` are copied verbatim from
[Adkid-Zephyr/anti-defensive-writing-Skill](https://github.com/Adkid-Zephyr/anti-defensive-writing-Skill)
(MIT); see `NOTICE`, `LICENSE.upstream` and `MANIFEST.json`.
