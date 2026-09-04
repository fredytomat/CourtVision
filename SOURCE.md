# CourtVision extension source

The extension/ directory is based on the published Chrome Web Store package 3.2.2, downloaded from Google's update service for extension oklbkdldkcchgihmadhbgojnamadihig. The store lists July 4, 2026 as its update date. The GitHub root ZIP remains a historical 2.6.0 package.

The published JavaScript, HTML, CSS, manifest and icons were copied without rebuilding. Store-generated _metadata was excluded. The manifest version remains 3.2.2 because this is a development baseline, not a new store release.

## Changes to the published package

- popup.js: remove an undefined ACTIVATION_KEY reference that prevented saving successfully validated keys.
- background.js: classify HTTP 408, 429 and 5xx as temporary verification failures, and stop logging complete license responses.
- popup.js: retain saved keys when verification is unavailable after the existing 24-hour grace period, while returning an error state instead of granting further Pro access.

Existing Polar checkout links, key storage names, 6-hour cache and 24-hour offline grace remain compatible. No payment provider or backend has been added. The content panel's separate format-only Pro check remains a known follow-up issue.

## Verification

Run `node --test tests/license.test.cjs`. The tests exercise extracted production functions and the activation handler with mocked Chrome storage and Polar responses. They cover successful activation, valid/revoked keys, cache/grace expiry and temporary HTTP failures. Syntax checks also pass for the changed scripts. No live customer license or payment was used. Full Chrome UI and live Polar integration still require validation before release.

Do not upload this development directory as a new CWS release until release testing and a version bump are complete. Do not raise the website minVersion yet.

Original downloaded CRX SHA-256: `0a72e8e95a90489e29b59e05accd9208c3766ec857ede329448628b2f79e5b10`.

GitHub upload was attempted but rejected with HTTP 403 (Resource not accessible by integration). No branch or pull request was created.
