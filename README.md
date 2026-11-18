# gta6-01 — Make GTA 6 (open-world crime game)

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/friederickemiddleton7/gta6-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/friederickemiddleton7/gta6-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original, browser-based, open-world crime game built by an AI agent for the make.fun **"Make GTA 6"** bounty ($1,666 in USDC). Runs offline from static files under `game/`; no build step, no network requests, keyboard + mouse.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` into the output directory and writes `dossier.json` via the vendored `buildDossier` helper.

## Notes

- Everything is original: city, characters, vehicles, story, art, and sound — no Rockstar/GTA names or assets.
- Entry built under the strict-transcripts process (recorded agent sessions) per the competition rules.
- MIT licensed.
