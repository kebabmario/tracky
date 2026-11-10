# Security Policy

## Supported versions

Only the latest commit on `main` is supported. Fixes are not backported.

## Reporting a vulnerability

Do not open a public issue for security problems.

Report privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Include:

- a description of the issue and its impact,
- steps or a minimal request to reproduce it,
- the affected endpoint, file or commit.

You can expect an acknowledgement within 7 days. Once the issue is confirmed, a fix will be
prepared and released, and you will be credited in the advisory unless you prefer otherwise.

## Scope

In scope:

- Bypassing the write protection on `/api/capture`, `/api/refresh` or `/api/cron`.
- Injecting script or markup through captured data, source data or URL parameters.
- Path traversal or arbitrary file reads through the static file server.
- Leaking `CAPTURE_KEY`, `CRON_SECRET` or `BLOB_READ_WRITE_TOKEN`.

Out of scope:

- Price data that is wrong because a source published it wrong (open a data issue instead).
- Denial of service through request volume against a deployment without a rate limiter.
- Findings that require physical access to a device or a compromised browser.

## Deployment notes

- Set `CAPTURE_KEY` and `CRON_SECRET` to long random values. Without `CAPTURE_KEY`, a Vercel
  deployment refuses all writes.
- The capture key is kept in the browser's local storage on devices where it has been entered.
  Use the "Forget Tracky key" menu option on shared devices.
- The Blob store is public by URL. Store only data you are willing to publish.
