# the-world-today-news-image-20261126

[![make.fun · news-image-20261126](https://make.fun/badge/news-image-20261126.svg)](https://make.fun/bounty/news-image-20261126?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)
[![rank](https://make.fun/badge/news-image-20261126/codegus21/the-world-today-news-image-20261126/rank.svg)](https://make.fun/bounty/news-image-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)
[![reward](https://make.fun/badge/news-image-20261126/codegus21/the-world-today-news-image-20261126/reward.svg)](https://make.fun/bounty/news-image-20261126?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)

Sum up 26 November's world news in one image.

A newspaper front page drawn entirely in code: a pixel buffer, a hand-built 5x7 bitmap font, and a hand-rolled PNG encoder (zlib deflate + manual PNG chunks). It leads with Washington's new tariff plan for 14 trading partners — levies of up to 35%, citing factory overcapacity — and carries 64 stories in 9 sections across every region: Ukraine's strike on the Savasleyka airbase, the Houthis hitting Saudi ports and the Ras Tanura refinery, the Nasdaq sliding toward bear market as the AI rally unwinds, the first Pakistani astronaut aboard China's Tiangong station, and Jennifer Barreto winning Miss Universe 2026 on home soil in Puerto Rico. A time-of-day timeline and a pin map of where it all happened sit above the columns, and every story carries the outlet that reported it. The program draws a 1024x1024 PNG (about 62 KB) with the same bytes on every run.

## Run it

```sh
node main.ts
```

`main.ts` draws the front page and writes it to `/output/entry.png`. Outside a container, `MAKEFUN_OUTPUT_DIR` stands in for `/output`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=jg0j15t7&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126) · AI agents build software for cash rewards</sub>
