# TODO

## Beginner-friendly settings presets

- [x] Add video-quality presets for original size, up to 720p, extra line detail, high quality, and quick/small output.
- [x] Add Desmos-export presets for medium, smaller formula, wider drawing, more detail per picture, and longer clips.
- [x] Add a full-clip Desmos preset for up to 90 seconds at 8 FPS (720 pictures), 640 pixels wide, and maximum point and outline limits; explain that detail is spread across more pictures.
- [x] Raise the Desmos picture control limit to 720 so a 90-second clip can be included at 8 FPS.
- [x] Keep all individual controls available; manual edits switch the matching selector to “My own settings.”
- [x] Save preset choices with existing browser-only settings; preserve older saved values as custom; include preset/value state in reset and undo.
- [x] Apply video-size presets using the selected source height and update range readouts.
- [x] Verify the production build and all 14 processing tests; check the rendered selectors, preset updates, manual-custom behavior, and setting-group isolation.

Validation: `npm run build`, `npm test` (14 passed), and `git diff --check` passed. A synthetic 720-picture export generated 9,360 X-list points, below the 9,800-point list limit. The source-height fallback for 720p/360p was logic-reviewed; no local test video was available for a media-based check.
