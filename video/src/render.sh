#!/bin/bash
# One command: capture the app screens → render frames → encode MP4s → add the light sounds → preview stills.
#   ./render.sh            vertical + square + stills
#   ./render.sh --fast     vertical only
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules/playwright ] && [ -d node_modules/ffmpeg-static ] || npm install --no-audit --no-fund
FFMPEG="$(node -e 'console.log(require("ffmpeg-static"))')"

node explainer/capture.mjs
node explainer/render.mjs --fmt vertical
if [ "${1:-}" != "--fast" ]; then
  node explainer/render.mjs --fmt square
fi

# Light sounds, no background (explainer/audio.mjs), muxed into each MP4 without re-encoding the picture.
node explainer/audio.mjs
for f in ../out/adhan-explainer.mp4 ../out/adhan-explainer-square.mp4; do
  [ -f "$f" ] || continue
  "$FFMPEG" -loglevel error -y -i "$f" -i ../out/soundtrack.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k \
    -shortest -movflags +faststart "${f%.mp4}.tmp.mp4" && mv "${f%.mp4}.tmp.mp4" "$f"
done

# Previews are taken from the finished MP4, so they show exactly what is in the video.
rm -f ../out/still-*.png ../out/preview-*.png
for t in 22.5 40.6 44.6 53.5; do
  "$FFMPEG" -loglevel error -y -ss "$t" -i ../out/adhan-explainer.mp4 -frames:v 1 "../out/preview-${t}s.png"
done
"$FFMPEG" -hide_banner -i ../out/adhan-explainer.mp4 2>&1 | grep -E "Duration|Video:" || true
ls -lh ../out
