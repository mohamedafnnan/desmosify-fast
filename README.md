# Desmosify Fast

Video to Desmos line art, fully client-side. A from-scratch rewrite focused on conversion speed.

## What changed vs. the original
- Parallel worker pool: the video is split into chunks traced by N workers; a dedicated encode worker draws and encodes off the main thread.
- No Desmos instance in the render path: polylines are drawn straight to an OffscreenCanvas (Desmos-style grid optional).
- No Potrace round trip: Canny edge pixels are chain-traced to centerline polylines, smoothed, then simplified (RDP).
- Near-identical frames (anime on twos/threes) skip decode readback, edge detection and tracing; optional variable-frame-rate output skips encoding them too.
- Integer, allocation-free Canny with sparse hysteresis.
- Desmos export (exact per-frame polygons, or a whole clip packed into lists) is kept.

## Run
    npm install && npm run dev      # dev server
    npm run build                   # static site in dist/
    npm test                        # edge/trace unit tests

Needs a browser with WebCodecs (Chrome/Edge/Safari 16.4+).
