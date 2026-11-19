# Desmosify Fast

Turn any video into **line art that looks like it was drawn in [Desmos](https://www.desmos.com/calculator)**, entirely in your browser. Nothing is uploaded; there is no server.

You drop in a video. Each frame is reduced to its outlines (edges), and the outlines are turned into lines. You then get one of two things:

1. **A rendered video.** The lines are drawn frame by frame, optionally over a Desmos-style grid, and encoded to an MP4 (or WebM) you can download.
2. **Desmos expressions.** Text you can paste into the real Desmos graphing calculator so Desmos draws the traced outlines. You can export one still picture or make an animated clip controlled by a slider. The animation can cover the whole source clip; choose the preset that fits your balance of smoothness, detail, and Desmos performance.

## How it works

For every frame:

1. **Decode** the frame with the browser's WebCodecs decoder (via [mediabunny](https://mediabunny.dev)).
2. **Detect edges** with an integer Canny detector: blur, gradient, thin the ridges, then keep strong edges and the weak edges connected to them.
3. **Trace** the edge pixels directly into polylines by following chains of pixels. There is no vectorizer step in between.
4. **Smooth and simplify** each line (light smoothing, then Ramer-Douglas-Peucker simplification) so you get clean curves with few points.
5. **Draw and encode** the lines in a worker and write the video file, or **export** them as Desmos expressions.

## Why it is fast

- **Parallel workers.** The video is cut into chunks and traced by several workers at once. A separate worker draws and encodes, so the page stays responsive.
- **No Desmos in the render path.** The video is drawn straight onto a canvas. It looks like Desmos (grid, axes, blue lines) but Desmos is not running.
- **Repeated frames are skipped.** If a frame barely changed from the last one (common in anime, which is often drawn "on twos" or "on threes"), the previous trace is reused. With **Variable frame rate** on, those frames are not even re-encoded.
- **Memory-bounded.** Workers never run far ahead of the encoder.

## Using it

1. Open the page and drop in a video (MP4, MOV, WebM or MKV).
2. Choose settings:
   - **Size**: output resolution.
   - **Detail ×**: trace resolution relative to the output size. Higher is more detail and slower.
   - **Edge cutoff**: higher keeps fewer, stronger edges.
   - **Line width**, **Threads**: line thickness and how many workers to use.
   - **Smooth curves**, **Desmos grid**, **Skip repeated frames**, **Variable frame rate**, **Keep audio**.
3. Click **Render video** to get a downloadable video, or **Convert for Desmos** to get a preview and paste-able expressions.

### Desmos export

- **Current picture:** exports the previewed picture as point lists and `polygon()` expressions. This is a still drawing, not an animation.
- **Whole clip:** exports an animated drawing. Paste the formulas into Desmos, set the `f` slider from `1` to `K` with a step of `1`, and press play beside `f`. The exporter divides long animations into manageable formula sections while keeping one slider for the full clip.
- **Smoother full clip:** keeps the source duration but samples at up to 8 pictures per second and caps the trace width at 640 pixels. This makes a smaller export than Ultra and may be easier for Desmos to play, but skips some source frames and has less fine detail.
- **Ultra / Maximum:** uses the source-reported frame count and average frame rate, with tracing at the source video width; there is no fixed 2,160-frame ceiling. For constant-frame-rate clips, these samples align with source frames. Variable-frame-rate clips are sampled at even timestamps, so they may not correspond one-to-one with encoded source frames. This makes a very large graph that may lag or take a long time to paste, calculate, or animate.

In every animated preset, the app converts video frames into traced outline curves; it does **not** recover the video's original mathematical equations or preserve its exact pixels, colors, or audio. Under **More Desmos settings**, a larger point budget and more contours can keep more detail but may increase lag. **Curve simplification** controls small bends: move left to keep them (more complex), or right to remove them (simpler curves). The exporter caps each generated list at 9,800 points as a safety limit and splits the animation into sections. At 40 frames per section, the maximum budget allows about 245 points per picture, so the effective outline-slot count can also be lower than the selected maximum. After generating formulas, use the displayed x/y bounds in Desmos **Graph Settings** if the graph appears blank.

Frame tracing and outline simplification run in CPU workers. Video decoding may use browser/hardware acceleration when available, but the app does not currently use WebGPU for tracing. The worker count starts from the browser-reported logical CPU count and is capped at 12 by default; the advanced control allows up to 32, but more workers can use more memory, heat, and battery, especially on phones.

## Limits

- Needs browser **WebCodecs** support and a decoder for the chosen video codec. Mobile support depends on the browser, OS version and codec; use the current system browser or try a compatible H.264 MP4.
- Long or very high-resolution videos use a lot of memory because the finished file is built in memory.
- Which codec you get depends on your browser (H.264 where available, otherwise VP9 or AV1).
- Output quality depends on the source: clean line-art and anime trace very well; noisy, dark or heavily textured footage produces busy results. Lower the **Edge cutoff** sensitivity or raise it to taste.

## Develop

```
npm install
npm run dev      # dev server
npm run build    # static site in dist/
npm test         # unit tests for the edge detector and tracer
```

The `.github/workflows/deploy.yml` workflow builds and publishes the site to GitHub Pages on every push to `main`.

## Code map

| File | Role |
| --- | --- |
| `src/lib/edges.ts` | Integer Canny edge detector |
| `src/lib/trace.ts` | Edge pixels to simplified polylines |
| `src/lib/frame.ts` | Frame processor and repeated-frame check |
| `src/lib/draw.ts` | Desmos-style renderer |
| `src/lib/desmos.ts` | Desmos expression export |
| `src/pipeline.worker.ts` | Decode a chunk of frames and trace them |
| `src/encode.worker.ts` | Draw frames in order and encode the video |
| `src/orchestrator.ts` | Worker pool, chunk scheduling, backpressure |
| `src/main.ts` | The interface |

## Credits

Inspired by the original [Desmosify](https://github.com/heyngra/desmosify) by heyngra (GPL). This is an independent rewrite with no code copied from it.
