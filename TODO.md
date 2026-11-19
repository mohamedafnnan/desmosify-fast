# TODO

## Beginner-friendly settings presets

- [x] Add video-quality presets for original size, up to 720p, extra line detail, high quality, and quick/small output.
- [x] Add Desmos-export presets for medium, smaller formula, wider drawing, more detail per picture, and longer clips.
- [x] Add the Ultra / Maximum Desmos preset using the source-reported frame count/rate and native pixel width, with no fixed frame-count cap; migrate older saved Full clip selections.
- [x] Add a Smoother full clip option that preserves duration while sampling at up to 8 FPS and capping drawing width at 640 pixels.
- [x] Add a Desmos curve-simplification control so users can trade tiny bends/detail for simpler curves, independently of video rendering.
- [x] Use the source-reported frame rate without a fixed 120-FPS ceiling; describe the 2,160 value as the source-reported count, not an app ceiling, and explain uniform timestamp sampling for variable-frame-rate sources.
- [x] Show the decoder/container reason when a video cannot be opened so unsupported mobile browser/codecs are diagnosable.
- [x] Default “Keep the video's sound” to checked for videos that contain audio; migrate the previous implicit audio-off default once while preserving explicit choices made in this version, and explain whether sound will be kept.
- [x] Add a plain-language “Keep tiny outlines” option that keeps short marks while warning that it may also keep noise.
- [x] Add on-page steps for copying formulas, matching Desmos graph bounds to the exact exported drawing size (including custom aspect ratios), setting f from 1 to K, and playing the clip.
- [x] Use the selected video’s native pixel width for full-source exports instead of the normal 640-pixel preset ceiling.
- [x] Split long Desmos exports into 40-frame sections with bounded lists, preserving about 245 points per picture at maximum budget and one shared slider for the full animation.
- [x] Keep all individual controls available; manual edits switch the matching selector to “My own settings.”
- [x] Save preset choices with existing browser-only settings; preserve older saved values as custom; include preset/value state in reset and undo.
- [x] Apply video-size presets using the selected source height and update range readouts.
- [x] Verify the production build and all 15 tests, including a 2,700-frame chunked export; check preset updates and setting-group isolation.

Validation: `npm run build`, `npm test` (15 passed), and `git diff --check` passed after the audio default, short-outline option, curve control and frame-rate update. A synthetic 2,700-frame export verified 68 Desmos-safe chunks of at most 40 frames, each below the 9,800-point list limit. No local test video or target mobile device was available for end-to-end verification.
