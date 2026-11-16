<img src="logo.svg" width="72" alt="Vinyl Scanner logo">

# Vinyl Scanner

Photograph a record cover and get the album, its track list by side (A1, B2…), and one-tap links to play it.

## What it does

- **Scan a cover** with the phone camera, pick a photo, or type the artist and album.
- **Play on** Spotify, Apple Music, YouTube Music, YouTube, Amazon Music, Tidal, Deezer, SoundCloud or Bandcamp. Switch platform without rescanning.
- **History** of the last 100 records, with the date scanned. Tap one to reopen it.

## Install on a phone

Open the page, then use **Share → Add to Home Screen** on iPhone (Safari) or **⋮ → Add to Home screen / Install app** on Android (Chrome). It then opens full screen with its own icon.

## Where it runs

The app is a single file, `index.html`, built as a Claude artifact. Cover recognition and account-synced history use the artifact runtime (`window.claude`), so they only work when the page is opened on claude.ai.

Opened anywhere else (for example GitHub Pages), the page still loads and "Type it in" still builds play links, but scanning shows "Cover recognition isn't available in this view" and history is kept on the device only. Running it standalone needs a small backend that calls a vision model.

## Files

- `index.html`: the whole app (markup, styles, script)
- `logo.svg`: app logo and favicon
- `manifest.json` and `icons/`: let the page be added to a phone's home screen and open full screen
