# Drop explainer

## Concept and script

A sealed letter travels to a server that cannot read it; its detachable key tag travels in the
link's `#fragment` to the recipient's browser. Reveal opens the letter in the browser while the
server's last copy burns away.

This illustrates the current plain-drop slice. There is no sign-in or Vault integration in the
story. Burning means deletion of stored ciphertext, not erasure of a recipient's copy. The page's
JavaScript comes from the server, so the illustration does not claim protection from a malicious
decryptor. An open is spent on delivery, before browser decryption succeeds.

| Time    | On-screen headline               | Action and supporting copy                                                                                                              |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0–4 s   | Seal it before it leaves.        | `drop send` encrypts on the sender's machine. Plain letter becomes a sealed envelope.                                                   |
| 4–8 s   | Only scrambled bytes go up.      | The server stores ciphertext it cannot read. The envelope moves to the server; the CLI prints a link.                                   |
| 8–12 s  | The key takes a different route. | Browsers never send the `#fragment` to a server. The URL's path drops toward the server; the key tag peels toward the browser.          |
| 12–16 s | A preview can't spend it.        | The page waits for a person to click Reveal. Hold before a single illustrated click.                                                    |
| 16–20 s | Open here. Gone there.           | Your browser decrypts. The last open deletes the server copy. Ciphertext is delivered, the stored copy burns, then the browser reveals. |
| 20–24 s | One open. Then it's gone.        | Default: 1 open, 24 hours. Expiry also deletes the ciphertext. Hold, then reset under a short dissolve.                                 |

## Storyboard gate

Fixed composition: sender on the left, server in the middle, recipient browser on the right. The
sender and server sit on small isometric limestone plinths; the browser is a single front-facing
page. A link above the stations splits into a downward request path and an ochre key route that ends
at the browser. Never draw a key inside or on a route into the server.

Six key frames follow the script table. The closing frame keeps the revealed letter in the browser
and an empty server. The reduced-motion frame combines that ending with the split-link diagram and
the statement “The server never sees the key.”

## Animatic gate

24 seconds, six four-second beats. Headlines stay in one position and dissolve in 240 ms. Physical
transfers take 0.8–1.2 seconds, leaving reading time. The click takes 160 ms. Delivery precedes
deletion and decryption; the burn and delivery share one cause. A 400 ms ending dissolve hides the
reset, and the first and last frames match.

Motion purpose: explanation, seen on first reading of the README. The sealed letter and key tag are
the leads. Supporting state labels crossfade; station names, plinths and layout remain still. Reject
decorative floating, moving headlines and perpetual server pulses: none explains a state change. Use
CSS `transform` and `opacity`, with `cubic-bezier(0.77, 0, 0.175, 1)` for travel and
`cubic-bezier(0.23, 1, 0.32, 1)` for arrivals. No libraries run inside the SVG.

The visual identity adapts Heka's limestone, lapis, ochre and faience pigments. System sans-serif
and monospace avoid external font loads. Ochre identifies the sender's key; faience identifies a
successful reveal. No gradients, glow, drop shadows or invented Heka logo.

The requested automatic README loop cannot offer a working pause button inside GitHub's image
sandbox. Reduced motion selects a static final frame; a separate still is also linked below the
README image. The MP4 has the player's normal pause controls.

## Rebuild

These are documentation assets; the app still has no build step. Python uses only its standard
library. The optional render tool needs Node, Playwright Core, an installed Chromium and ffmpeg.
Install Playwright Core outside the repository, then point `PLAYWRIGHT_MODULE` at its `index.mjs`.
`CHROMIUM_PATH`, `FFMPEG_PATH` and `QA_DIR` optionally override discovery and output locations.

```sh
python3 docs/media/build.py
python3 docs/media/verify.py
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node docs/media/render.mjs --video
```

Omit `--video` for screenshots and image-context QA only. The video uses the light palette, 24
seconds at 1280 × 720 and 30 fps, H.264, no audio, with fast-start metadata. It seeks Chromium's
original CSS animations for each frame rather than reimplementing the animation in a video tool.
Generated SVGs are excluded from Deno formatting; the generator is their editable source.

## QA and review

The concept, six-frame storyboard and rough 24-second animatic were inspected before building the
finished assets. The storyboard caught a color ambiguity: the HTTP request route uses lapis, and
only the key route uses ochre.

| Finding                                                                            | Resolution                                                                                                       | Verification                                                                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Chromium does not propagate reduced-motion preferences into an SVG image document. | Keep the SVG media rule for direct viewing, and select explicit light/dark stills with README `picture` sources. | Direct SVG has zero running animations; image source switches to the still and its screenshots match over time. |
| The key tag collided with a redundant “Key” label.                                 | Remove the label; `#key` identifies the tag.                                                                     | Inspected the split-link frames in both themes.                                                                 |
| A moving headline would compete with the letter and tag.                           | Headlines change only through opacity; stations remain fixed.                                                    | Inspected the storyboard and seven finished timestamps per theme.                                               |
| A long-running image cannot expose an interactive pause control on GitHub.         | Include a still link, reduced-motion sources and a video with player controls.                                   | README image stays self-contained and needs no scripts.                                                         |

Motion review: approved for this explanatory illustration. Only transforms and opacity animate;
there are no layout animations, filters, external resources, JavaScript, hover states or interactive
sequences to interrupt. Travel uses the shared ease-in-out curve; the illustrated press is 160 ms.
The burn is one short state change on the stored envelope, not ambient particle decoration.
Real-device GPU profiling and GitHub's production image proxy are not covered by local Chromium QA.

The render tool samples 1, 6.6, 10.7, 14, 16.95, 18.8 and 21.5 seconds in both themes, compares the
loop boundary byte for byte, checks unmodified SVG animation inside an `img`, and captures 768 px
and 390 px layouts. At phone width the explanatory captions are small; the headline, image alt text,
nearby README explanation and linked full-size still provide the same information.

Security copy review against README and ADR 0001: only ciphertext goes to storage; the key follows
the fragment into the browser; an explicit Reveal spends the open; deletion applies to the last
allowed open or expiry. The illustration shows the default one-open case. The server copy burns
while the recipient's revealed letter remains. Server-supplied JavaScript remains a trust boundary,
and the SVG description records it. All URLs and content are illustrative placeholders.
