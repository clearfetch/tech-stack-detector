`extra-technologies.json` holds our own fingerprint additions, merged on top of the upstream webappanalyzer
database by `loadDatabase()` in `src/engine.js`. Pattern arrays are concatenated and pattern maps merged per key,
so an entry only ever adds detections. It lives outside `data/technologies/` on purpose: `scripts/update-db.sh`
rewrites that directory and would otherwise delete these.

Add an entry when a user reports a technology we miss. Prefer `scripts` (inline JavaScript body) and `html`
patterns, since those are the channels a browser-based detector sees and a static fetch does not. Give weak
evidence an explicit `\;confidence:50` so it never reads as certain.
