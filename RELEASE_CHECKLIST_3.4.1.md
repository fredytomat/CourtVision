# CourtVision Extension 3.4.1 — Release Checklist

## Product scope

- Product being released: CourtVision Chrome desktop extension.
- Supported systems: Chrome on Windows, macOS, and Linux.
- CourtVision Mobile and Hardwood are not included in this release.
- One CourtVision account can have one active laptop.

## New-user journey

1. Open `courtvision.id` and select **Coba Gratis**.
2. Install CourtVision from the Chrome Web Store.
3. The welcome page opens automatically.
4. Select **Masuk dengan Google & Mulai Trial**.
5. The seven-day trial starts and the sample YouTube video opens.
6. Create one tag and confirm that the clip is stored.

## Paid-access journey

1. From a Trial or Expired account, select **Aktifkan PRO**.
2. Confirm the Google account email is filled and locked on checkout.
3. Select 30 days or 365 days.
4. Confirm QRIS appears among the active Duitku methods.
5. Complete one real low-value purchase only when a final production test is required.
6. Confirm the result page changes to **Pembayaran berhasil**.
7. Return to YouTube and reopen CourtVision.
8. Confirm the badge shows **PRO** and the correct access-expiry date.

## Regression checks

- Existing local clips survive the extension update.
- Tag buttons create clips at the expected timestamps.
- Start/end adjustment buttons work.
- YouTube clip playback opens at the correct time.
- WhatsApp link opens the universal clip viewer.
- JSON backup can be restored without deleting newer clips.
- CSV, JSON, and XML exports download successfully.
- XML and JSON are readable by the intended downstream software.
- Signing out permits a different Google account to sign in.
- No manual license key, Polar checkout, staging address, or mobile-product purchase is visible.

## Store upload

- Upload only `CourtVision-Extension-v3.4.1-Production.zip`.
- Do not upload the containing folder, source repository, tests, server code, or backups.
- Keep the existing Chrome Web Store item ID: `oklbkdldkcchgihmadhbgojnamadihig`.
- Submit the update for review only after the clean-profile test passes.
