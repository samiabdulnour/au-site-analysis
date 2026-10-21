# The free side's watermark

Put the artwork here as `watermark.png` (a transparent background works
best). Every page of a PDF downloaded by a free account gets it once, in the
middle, 60% of the page's width, at 20% opacity — see
`src/render/watermark.ts`.

Until the file is here, the words `SITE ANALYST · FREE` stand in.

Replacing the file needs no restart: stamped copies are named after the
artwork's hash, so the next download is stamped with the new one.
