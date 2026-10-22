# The free side's watermark

`watermark.pdf` is the office's bird sheet (the flamingo, the kingfisher, the
heron and their company), one vector page of plain filled paths in yellow.
Every page of a PDF downloaded without a subscription gets it laid over the
whole page at 30% opacity, and `site-analyst.com` is written in its bottom-left
corner — see `src/render/watermark.ts`.

To replace it, put another one-page PDF here under the same name. Draw it as
plain filled paths with no transparency of its own: an opacity set inside the
page overrides the one the stamp draws it at, and it comes out solid. A PDF
printed from a browser sets one, so build it with pdf-lib's `drawSvgPath` or
an editor's flattened export.

Without `watermark.pdf`, a `watermark.png` here (a transparent background works
best) is drawn once in the middle of every page, 60% of the page's width, at
20% opacity; without either, the words `SITE ANALYST · FREE` stand in.

Replacing the file needs no restart: stamped copies are named after the
artwork's hash, so the next download is stamped with the new one.
