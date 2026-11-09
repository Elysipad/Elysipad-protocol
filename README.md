# ELYSIPAD

**Every project deserves a sunrise.** A Solana launch pad built on open numbers, short rules and a calm interface.

[![Live site](https://img.shields.io/badge/live-elysipad.fun-f1ba5d?style=flat-square)](https://elysipad.fun)
![Chain](https://img.shields.io/badge/chain-Solana-3fa9f5?style=flat-square)

| | |
|---|---|
| Chain | Solana |
| Contract address (CA) | pending |
| Site | https://elysipad.fun |

## Overview

ELYSIPAD is a static, dependency-free site for a Solana project. A live market board shows the busiest Solana pairs, and a pinned first row is reserved for the project's own token. Every external fact (contract address, social channels, data sources) lives in a single register, and anything not yet confirmed renders as an inert, clearly labelled placeholder.

## Features

- Live Solana market board: top pairs by 24h volume with logo, price, 24h change, volume, liquidity and a copy-address button
- Matching ticker, skeleton loading, count-up numbers with change flashes, backoff on failure, and a pause while the tab is hidden
- Pinned own-token row that switches from a brand placeholder to live data the moment a contract address is stated
- Contract address strip, always visible, click to copy
- Register-driven channels: links exist only for confirmed records
- Motion with a reduced-motion fallback that removes every animation
- Gates that check the register, palette, copy, addresses, dates, accessibility sizes and layout at five widths

## Links

- Site: https://elysipad.fun
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Build

```bash
npm install
npm run build   # writes dist/
npm run gates   # static, unit, mutation and browser checks
```

Deploy by uploading the `dist/` folder.

## License

MIT, see [LICENSE](LICENSE).
