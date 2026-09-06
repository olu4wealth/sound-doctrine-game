# Vendored third-party libraries

These are committed rather than installed so the game keeps its "no build step,
no runtime npm dependency" posture, and so the service worker can precache them
(a CDN `<script>` would break offline play and installability).

| File | Version | Source | License |
|---|---|---|---|
| `gsap.min.js` | 3.15.0 | `gsap/dist/gsap.min.js` | GreenSock standard "no charge" — https://gsap.com/standard-license |
| `Flip.min.js` | 3.15.0 | `gsap/dist/Flip.min.js` | GreenSock standard "no charge" |

To update: `npm install gsap --no-save && cp node_modules/gsap/dist/{gsap,Flip}.min.js vendor/`
then bump `CACHE_VERSION` in `sw.js` so clients pick up the new files.
