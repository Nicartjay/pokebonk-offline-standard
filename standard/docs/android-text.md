# Android text-outline compatibility

Unreleased source fix for the tablet reports after v1.3.0; no version/tag or
published release is changed by this work.

Some tablet WebViews paint `-webkit-text-stroke` over the letter fill despite
the original `paint-order: stroke fill`. Thick strokes can therefore turn
Pokédex+ names and small combat labels into almost solid outline-colored text.

`runtime/android-text.js` runs only after positive native Android detection.
It reads the game's same-origin packaged CSS through CSSOM and supplies scoped
behind-fill shadow outlines. The stroke's original color, half-width visible
radius, drop shadow/glow, responsive rules and state selectors are retained.
Text color/fill, fonts, sizing, layout, animations and game values are unchanged.

The fallback is installed before `home.css`, preserving its already-reviewed
thin HP/friendship and logo exceptions. Lazy stylesheet load events cover
Pokédex+, event and Relay screens too. Each loaded stylesheet is cached; there
is no gameplay DOM observer, per-frame scan, network request or native bridge.
Canvas text already draws its stroke before its fill and is not rewritten.

The accepted upstream CSS has 63 stroke declarations. The authored focused
regressions cover their value forms, media/supports wrappers, transparent logo
shine, lazy loading, positive Android detection and unchanged desktop behavior.
They await screenshot approval before execution.

Source screenshots under `evidence/android-text-fix-2026-11-25/` use only a
disposable in-memory profile. Combat labels are staged still copies from the
original popup factory, not an actual connected match or physical-tablet test.
No native package, installation, save import/change, service deployment or
publication is part of the preview.
