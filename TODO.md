# TODO

## Beginner-friendly settings presets

- [x] Add video-quality presets for original size, up to 720p, extra line detail, high quality, and quick/small output.
- [x] Add Desmos-export presets for medium, smaller formula, wider drawing, more detail per picture, and longer clips.
- [x] Add a full-source Desmos preset that uses every source frame at its native FPS, with no fixed 720-frame or 90-second ceiling.
- [x] Split long Desmos exports into separate bounded lists while keeping one shared frame slider for the full animation.
- [x] Keep all individual controls available; manual edits switch the matching selector to “My own settings.”
- [x] Save preset choices with existing browser-only settings; preserve older saved values as custom; include preset/value state in reset and undo.
- [x] Apply video-size presets using the selected source height and update range readouts.
- [x] Verify the production build and all 15 tests, including a 2,700-frame chunked export; check preset updates and setting-group isolation.

Validation: `npm run build`, `npm test` (15 passed), and `git diff --check` passed. A synthetic 2,700-frame export verified two Desmos-safe chunks, each below the 9,800-point list limit. Full-source frame selection was checked in code; no local video was available for an end-to-end media export.
