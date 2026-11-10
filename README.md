# Tracky

A commodity price terminal for rubber, plastic resin and base metals. Tracky collects daily prices
from public market sources, stores them as time series, and presents them in a dense,
keyboard-driven watchlist with charts, statistics and currency conversion.

Live instance: <https://tracky.kebabmario.dev>

## Coverage

| Group | Instruments | Source | Frequency | Native unit |
|---|---|---|---|---|
| Rubber | SMR 5, SMR 10, SMR 20 | Malaysian Rubber Board | Daily | MYR/kg |
| Rubber | PH rubber (cuplump, national farmgate) | Philippine Statistics Authority (OpenSTAT) | Monthly, ~3-4 months lag | PHP/kg |
| Plastic resin | PVC (SG-5), LDPE, EVA, PP homopolymer, ABS | Guidechem GuideTrends, China spot | Daily | CNY/t |
| Plastic resin | AS (SAN), PP block copolymer | Manual capture (see below) | On capture | CNY/t |
| Metals | Copper, aluminium, wire rod | Shanghai Futures Exchange, main contract settlement | Daily | CNY/t |
| Metals | Copper, aluminium | London Metal Exchange official cash settlement, via Westmetall | Daily | USD/t |
| FX | PHP, MYR, CNY, EUR per USD | ECB reference rates, via Frankfurter | Daily | - |

Every price is stored in its market's own currency. Conversion to another currency happens in the
client using the ECB rate for that observation's own date, never today's rate.

## Features

- Watchlist with ticker codes, last price, absolute and percentage change, and 7-day sparklines.
- Instrument view with a crosshair chart. SHFE contracts add a volume and open-interest panel and an
  OHLC tooltip; LME metals add a warehouse-stock panel.
- Statistics: period returns, YTD, 30-day annualised volatility, 50/200-day moving averages,
  90-day return correlation against LME copper, 52-week range.
- Comparison chart per group with daily, weekly, monthly or yearly aggregation.
- Command bar (`/` or `Ctrl/Cmd+K`) for instruments, sources, actions and currency.
- Installable PWA with offline access to the last loaded prices.
- "Send to Tracky" bookmarklet for sources that cannot be fetched automatically (see Manual capture).

## Architecture

```
server.js        HTTP server: static files, JSON API, write authentication, cron endpoint
scraper.js       Source adapters, parsing, merge, storage layer (local file or Vercel Blob)
auth.js          Constant-time key comparison
public/          Single-page client (no build step), capture page, service worker, icons
public/agg.js    Pure time-series helpers shared by client and tests
test/            node:test suite for parsers, aggregation and statistics
data/prices.json Seed / local data store
scripts/icons.js Dependency-free PNG icon renderer
```

The client is plain HTML and ES modules with Chart.js from a CDN. There is no bundler and no
framework. The only package the server code imports is the Vercel Blob SDK, and only when Blob
storage is configured.

### Data model

Each series is an array of observations `{ date, native, v, ...extra }`:

- `native` is the number exactly as the source publishes it, in the source's unit.
- `v` is `native` normalised to the display unit (per kg for resin and rubber, per tonne for metals),
  still in the series' home currency.
- `extra` carries optional source fields: SHFE `o, h, l, c, vol, oi`, LME `stock`, and `src` for
  manually captured observations.

`v` is always recomputed from `native` on save, so a change to a unit factor migrates stored data.
When a source changes, the stored series is discarded rather than mixed with the old source.

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/prices` | none | Full dataset, metadata and FX history |
| POST | `/api/refresh` | `X-Tracky-Key` | Run all scrapers and return the dataset |
| POST | `/api/capture` | `X-Tracky-Key` | Save one price or a batch of up to 1,500 |
| GET | `/api/cron` | `Authorization: Bearer <CRON_SECRET>` | Scheduled refresh for Vercel Cron |

Write endpoints accept requests without a key only when the server runs locally and `CAPTURE_KEY`
is unset. On Vercel they are refused until `CAPTURE_KEY` is configured.

## Getting started

Requirements: Node.js 20 or later.

```bash
git clone https://github.com/kebabmario/tracky.git
cd tracky
npm install
npm start
```

Open <http://localhost:3000>. Locally the server scrapes on start and every six hours, and stores
data in `data/prices.json`. To run a single scrape without the server:

```bash
npm run scrape
```

Run the tests:

```bash
npm test
```

## Configuration

All variables are optional for local use. Copy `.env.example` to `.env` and start the server with
`node --env-file=.env server.js`; on Vercel, set them under Settings, Environment Variables.

| Variable | Used for |
|---|---|
| `PORT` | HTTP port, default `3000` |
| `CAPTURE_KEY` | Shared secret required by `/api/capture` and `/api/refresh` |
| `CRON_SECRET` | Bearer token expected on `/api/cron` |
| `BLOB_READ_WRITE_TOKEN` | Switches storage from the local file to Vercel Blob |

## Deployment (Vercel)

1. Import the repository in Vercel.
2. Create a Blob store under Storage and connect it to the project. This sets `BLOB_READ_WRITE_TOKEN`.
3. Add `CAPTURE_KEY` and `CRON_SECRET` as environment variables with long random values.
4. Deploy. `vercel.json` schedules `/api/cron` daily at 10:00 UTC.

Vercel functions have a read-only filesystem, so the deployment reads `data/prices.json` only as a
seed on first run and writes every later version to Blob. Each save is a new blob; the latest is
current and the five most recent are retained.

## Manual capture

Two resins have no source that permits automated access. Their pages are protected by bot
mitigation, and Tracky does not attempt to bypass it. Instead, the bookmarklet runs in your own
browser on a page you have opened normally:

1. Open the menu in the top bar and drag "Drag me" onto the bookmarks bar.
2. Open the price page for the material on the source site.
3. Click the bookmark. It reads the page's tables and any chart series already rendered in the page
   (ECharts, Highcharts, Chart.js) and opens the capture form.
4. Confirm the material, price and date. If a chart was found, the full history can be saved in one step.

Captures are also accepted for ABS and PP homopolymer, where they extend the automated series.
On dates covered by both, the automated feed takes precedence.

## Data and usage notes

- Prices are the property of their respective publishers. Tracky stores and redistributes only what
  each source publishes publicly. Review each source's terms before deploying a public instance.
- Wire rod futures on SHFE trade thinly; treat their settlement prices with care.
- Guidechem headline prices can differ from the narrative on the same page. Tracky records the headline.
- Nothing in this project is investment advice.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
