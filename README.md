# Whatcom Maritime Storytelling Atlas — GitHub Pages build

This folder is prepared specifically for GitHub Pages.

## Upload
Upload **all files in this folder directly to the root of the GitHub repository**. Do not upload the ZIP itself and do not put these files inside another folder.

The repository root should contain files such as:
- index.html
- mapped.html
- tides.html
- styles.css
- mapped.js
- tides.js
- atlas-aerial.png
- icon-hub.png
- icon-memories.png
- icon-tides.png
- icon-voices.png
- .nojekyll

## GitHub Pages
Repository Settings → Pages → Deploy from a branch → `main` → `/(root)`.

Expected URLs:
- Hub: `/whatcom-maritime-atlas/`
- Tides: `/whatcom-maritime-atlas/tides.html`
- Mapped Memories: `/whatcom-maritime-atlas/mapped.html`

## Why assets are flat
All image assets are deliberately stored at the repository root and referenced with relative filenames. This avoids folder upload, capitalization, and path issues on GitHub Pages.
