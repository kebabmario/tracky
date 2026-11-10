# Contributing

Thanks for taking the time to improve Tracky. This document covers how to report problems, propose
changes and get a pull request merged.

## Before you start

- Search existing issues first. If one already describes your problem or idea, add detail there
  instead of opening a duplicate.
- For anything larger than a small fix, open an issue to agree on the approach before writing code.
- Security problems must not be reported in public issues. See [SECURITY.md](SECURITY.md).

## Reporting bugs and suggesting changes

Use the issue templates:

- **Bug report** for incorrect behaviour, crashes or broken layouts.
- **Data issue** for wrong, missing or stale prices from a specific source.
- **Suggestion** for new features, instruments or sources.

Include the instrument code (for example `CU.SHF`), the date involved, and what you expected to see.
For data issues, a link to the source page showing the correct value is the most useful thing you
can provide.

## Development setup

```bash
git clone https://github.com/kebabmario/tracky.git
cd tracky
npm install
npm test
npm start
```

The app runs at <http://localhost:3000> and stores data in `data/prices.json`. There is no build
step; edit files in `public/` and reload.

## Guidelines

**Scope.** Keep each pull request to one change. Refactors and behaviour changes go in separate PRs.

**Dependencies.** Avoid adding them. The client loads Chart.js from a CDN and nothing else; the
server uses Node built-ins plus the Vercel Blob SDK. A new dependency needs a clear reason that a
few lines of code cannot meet.

**Code style.** Match the surrounding code: ES modules, two-space indentation, single quotes,
semicolons. Comments explain why, not what.

**Data sources.** New sources must be publicly accessible without authentication, must not require
circumventing bot protection, CAPTCHAs or rate limits, and must be used within their terms of use.
Pull requests that bypass access controls will be closed.

**Parsers.** Every source adapter needs a pure parse function with a test built from a trimmed copy
of the real response. Parsers must fail loudly (throw) on unexpected input rather than store
partial or guessed values.

**Storage.** Never write a value that was not read from a source or entered by the user. Keep the
`native` field exactly as the source publishes it.

**UI.** The interface is a data terminal: dense, neutral and consistent. No emoji, decorative
gradients or animations that carry no information. Check desktop, tablet (1024 px) and phone
(375 px) widths, and keyboard access.

## Tests

```bash
npm test
```

All tests must pass. Add or update tests for any change to parsing, aggregation, statistics,
validation or authentication.

## Commit messages

Use the imperative mood and keep the subject under 72 characters, for example
`Add LME nickel cash settlement`. Explain the reason for the change in the body when it is not
obvious from the diff.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make the change, with tests.
3. Run `npm test`.
4. Open a pull request using the template and link the related issue.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
