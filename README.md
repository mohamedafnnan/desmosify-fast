# Desmosify Fast

Turn any video into **line art that looks like it was drawn in [Desmos](https://www.desmos.com/calculator)**, entirely in your browser. Nothing is uploaded; there is no server.

You drop in a video. Each frame is reduced to its outlines (edges), and the outlines are turned into lines. You then get one of two things:

1. **A rendered video.** The lines are drawn frame by frame, optionally over a Desmos-style grid, and encoded to an MP4 (or WebM) you can download.
2. **Desmos expressions.** Text you can paste into the real Desmos graphing calculator so the shapes are drawn by Desmos itself, either one exact frame at a time or a whole short clip packed into a few lists you animate with a slider.

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

- **Current frame (exact):** the frame being previewed as lists of points drawn with `polygon()`. Paste the lines into a Desmos graph.
- **Whole clip (compact):** the clip packed into two lists, `X` and `Y`. Paste it into Desmos and drag the slider `f` from 1 to the number of frames to animate it. To fit Desmos' list limit, only the longest contours are kept, and the note under the export box says how many were dropped. The export settings (frames, fps, width, budget, contours) are under **Desmos export settings**.

Clip export has been tested for structure only; I have not pasted its output into the live Desmos calculator.

## Limits

- Needs a browser with **WebCodecs** (recent Chrome or Edge; recent Safari).
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
