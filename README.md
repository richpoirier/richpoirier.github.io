# richpoirier.github.io

Static public assets used by Richard's personal integrations, plus a proof of
concept for encrypted share pages.

The repository contains no private keys, credentials, tokens, or plaintext
personal content. Files under `share/` are opaque AES-256-GCM ciphertext. Their
decryption keys live only in URL fragments (`#k=...`), which browsers do not
send to GitHub Pages.

## Create a private share page

Start with a self-contained HTML file outside this repository, then run:

```bash
node scripts/create-private-share.mjs \
  --input /path/to/private-report.html \
  --expires 2026-10-05T07:00:00Z
```

The command creates `share/<random-id>/index.html` and prints the complete
capability link. Commit only the encrypted output, never the source report or
the printed key.

Anyone with the complete link can read the page. Deleting the published file
revokes ordinary access, but cannot retract copies that a recipient already
saved; this is a lightweight sharing POC, not identity-based access control.
