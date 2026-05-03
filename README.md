# Bilibili MrBeastify

A Chromium Manifest V3 browser extension that adds MrBeast overlays to Bilibili thumbnails.

This is a Bilibili adaptation of [MagicJinn/MrBeastify-Youtube](https://github.com/MagicJinn/MrBeastify-Youtube). The original project is MIT licensed; this adaptation keeps the original license and image-asset structure.

## What It Covers

- Bilibili home feed cards, search result cards, video-page recommendations, small recommendation cards, live/video covers, ads, banners, and other cover-like images.
- Dynamic Bilibili UI updates, including infinite scroll, "change" refreshes, lazy-loaded recommendations, and SPA-style navigation.
- Original-style settings for enabling/disabling the extension, controlling appear chance, and controlling flip chance.

The extension intentionally skips obvious avatars, logos, icons, status badges, emoji, and tiny UI images.

## Local Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select the local `MrBeastify-Bilibili` repository folder.
5. Visit Bilibili pages such as:
   - `https://www.bilibili.com/`
   - `https://search.bilibili.com/all?keyword=AI`
   - `https://www.bilibili.com/video/BV1hV9aBGEgi`

## Files

- `manifest.json`: Chromium MV3 extension manifest.
- `mrbeastify.js`: Bilibili thumbnail detection, overlay insertion, settings listener, and dynamic-page observer.
- `settings.html` and `settings.js`: Extension popup.
- `images/`: Transparent MrBeast overlays from the upstream project.

## Development Checks

```bash
npm install
npm run check
npm run smoke
```

`npm run smoke` loads this folder as an unpacked extension in Microsoft Edge by default, visits representative Bilibili pages, checks dynamic updates, verifies settings storage, and writes screenshots to `test-artifacts/`.

## Notes

- This extension is unofficial and is not affiliated with Bilibili, YouTube, or MrBeast.
- Before publishing publicly, re-check rights and store policy requirements for the bundled personality/image assets.
