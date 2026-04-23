# Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - 2026-04-23

### Added

- Added the first official Android circuit viewer release, built as a native landscape-only viewer instead of a browser-based mobile experience.
- Added mobile QR-code opening and deep-link based snapshot loading for fast handoff from the Windows desktop app.
- Added a dark theme path for the mobile viewer and aligned icon assets across desktop and Android.
- Added Android release-signing support through `keystore.properties` or `EA_ANDROID_*` environment variables.

### Changed

- Promoted the current Windows desktop installer and Android signed APK as the official `1.1.0` release.
- Improved mobile rendering performance by switching to a native canvas renderer and avoiding the previous browser preview path.
- Brought mobile focus behavior closer to desktop expectations, including relation focus layout, focus animation, and common component symbols.
- Updated circuit terminal modeling to keep only `input` and `output` directions in the project rules and related validation flow.
- Refined viewer interaction behavior and mobile layout adaptation for horizontal use.

### Fixed

- Fixed desktop startup flow so the backend starts automatically with the application and no extra console window is left visible.
- Fixed packaging flow so running desktop instances are closed before building release artifacts.
- Fixed icon generation and packaging so the final Windows installer, desktop executable, and Android launcher assets all use the same source image.
- Fixed Android release packaging to produce a properly signed installable release APK.

[1.1.0]: https://github.com/Caltsic/EasyAnalyse/releases/tag/v1.1.0
