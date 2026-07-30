#!/usr/bin/env node

import { randomBytes, webcrypto } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SITE_URL = 'https://richpoirier.github.io'

function usage(message) {
  if (message) console.error(`Error: ${message}\n`)
  console.error(`Usage:
  node scripts/create-private-share.mjs --input <standalone.html> [options]

Options:
  --output-root <dir>  Destination root relative to this repository (default: share)
  --site-url <url>     Published site origin (default: ${DEFAULT_SITE_URL})
  --expires <iso>      Optional client-enforced expiration timestamp
  --slug <value>       Optional opaque path for testing; otherwise generated randomly
  --help               Show this help
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const options = {
    outputRoot: 'share',
    siteUrl: DEFAULT_SITE_URL,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') usage()
    if (!argument.startsWith('--')) usage(`Unexpected argument: ${argument}`)

    const value = argv[index + 1]
    if (!value || value.startsWith('--')) usage(`Missing value for ${argument}`)
    index += 1

    if (argument === '--input') options.input = value
    else if (argument === '--output-root') options.outputRoot = value
    else if (argument === '--site-url') options.siteUrl = value
    else if (argument === '--expires') options.expires = value
    else if (argument === '--slug') options.slug = value
    else usage(`Unknown option: ${argument}`)
  }

  if (!options.input) usage('--input is required')
  return options
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function validateSlug(value) {
  if (!/^[a-z0-9][a-z0-9-]{15,127}$/.test(value)) {
    usage('--slug must be 16–128 lowercase letters, digits, or hyphens')
  }
  return value
}

function normalizeExpiration(value) {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) usage('--expires must be a valid ISO date or timestamp')
  if (timestamp <= Date.now()) usage('--expires must be in the future')
  return new Date(timestamp).toISOString()
}

function renderEncryptedShell({ ciphertext, iv }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>A private page for you</title>
  <style data-private-shell>
    :root { color-scheme: light; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body.private-shell {
      display: grid;
      min-height: 100svh;
      place-items: center;
      padding: max(24px, env(safe-area-inset-top)) 22px max(24px, env(safe-area-inset-bottom));
      background:
        radial-gradient(circle at 12% 10%, rgba(193, 139, 105, .22), transparent 34%),
        radial-gradient(circle at 88% 88%, rgba(104, 132, 112, .2), transparent 36%),
        #f3efe7;
      color: #24352f;
    }
    .private-shell-card { width: min(100%, 420px); text-align: center; }
    .private-shell-mark {
      display: grid;
      width: 58px;
      height: 58px;
      margin: 0 auto 22px;
      place-items: center;
      border: 1px solid rgba(36, 53, 47, .16);
      border-radius: 50%;
      background: rgba(255, 255, 255, .54);
      box-shadow: 0 18px 45px rgba(45, 54, 47, .1);
      font-size: 23px;
    }
    .private-shell h1 { margin: 0 0 10px; font-family: ui-serif, Georgia, serif; font-size: clamp(28px, 8vw, 38px); font-weight: 500; letter-spacing: -.025em; }
    .private-shell p { margin: 0 auto; max-width: 34ch; color: #617069; font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body class="private-shell">
  <main class="private-shell-card" aria-live="polite">
    <div class="private-shell-mark" aria-hidden="true">✦</div>
    <h1 id="private-shell-title">Opening your private page…</h1>
    <p id="private-shell-message">The full link carries the key. It never gets sent to this website.</p>
  </main>
  <script id="private-payload" type="application/octet-stream" data-iv="${iv}">${ciphertext}</script>
  <script>
    (() => {
      const title = document.querySelector('#private-shell-title')
      const message = document.querySelector('#private-shell-message')

      const fail = (heading, detail) => {
        title.textContent = heading
        message.textContent = detail
      }

      const decodeBase64Url = (value) => {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
        return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
      }

      const installShareControls = () => {
        document.querySelectorAll('[data-private-share]').forEach((button) => {
          button.addEventListener('click', async () => {
            const status = document.querySelector('[data-private-share-status]')
            try {
              if (navigator.share) {
                await navigator.share({ title: document.title, url: window.location.href })
                if (status) status.textContent = 'Shared.'
                return
              }
              await navigator.clipboard.writeText(window.location.href)
              if (status) status.textContent = 'Private link copied.'
            } catch (error) {
              if (error?.name === 'AbortError') return
              window.prompt('Copy the complete private link:', window.location.href)
              if (status) status.textContent = 'Keep the #k=… part when you copy it.'
            }
          })
        })
      }

      const reveal = async () => {
        const fragment = new URLSearchParams(window.location.hash.slice(1))
        const encodedKey = fragment.get('k')
        if (!encodedKey) {
          fail('This link is incomplete', 'Ask the sender to copy the whole link, including the #k=… part at the end.')
          return
        }

        try {
          const keyBytes = decodeBase64Url(encodedKey)
          if (keyBytes.byteLength !== 32) throw new Error('invalid key length')

          const payload = document.querySelector('#private-payload')
          const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
          const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decodeBase64Url(payload.dataset.iv), tagLength: 128 },
            key,
            decodeBase64Url(payload.textContent.trim()),
          )
          const envelope = JSON.parse(new TextDecoder().decode(plaintext))
          if (envelope.version !== 1 || typeof envelope.document !== 'string') throw new Error('invalid payload')
          if (envelope.expiresAt && Date.now() >= Date.parse(envelope.expiresAt)) {
            fail('This page has expired', 'Ask the sender for a fresh private link.')
            return
          }

          const parsed = new DOMParser().parseFromString(envelope.document, 'text/html')
          const parsedTitle = parsed.querySelector('title')?.textContent?.trim()
          if (parsedTitle) document.title = parsedTitle
          document.documentElement.lang = parsed.documentElement.lang || 'en'
          document.documentElement.className = parsed.documentElement.className

          parsed.head.querySelectorAll('style, meta[name="theme-color"], meta[name="color-scheme"], link[rel="icon"]').forEach((node) => {
            document.head.append(document.importNode(node, true))
          })

          document.body.className = parsed.body.className
          document.body.replaceChildren(...Array.from(parsed.body.childNodes, node => document.importNode(node, true)))
          installShareControls()
        } catch (_) {
          fail('This private link did not open', 'It may be incomplete, mistyped, expired, or revoked. Ask the sender for a fresh link.')
        }
      }

      reveal()
    })()
  </script>
</body>
</html>
`
}

const options = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(options.input)
const source = await readFile(inputPath, 'utf8')
if (!/<html[\s>]/i.test(source) || !/<body[\s>]/i.test(source)) {
  usage('--input must be a standalone HTML document')
}

const expiresAt = normalizeExpiration(options.expires)
const slug = validateSlug(options.slug || randomBytes(16).toString('hex'))
const outputRoot = path.resolve(repoRoot, options.outputRoot)
const outputPath = path.join(outputRoot, slug, 'index.html')
const relativeOutput = path.relative(repoRoot, outputPath)
if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
  usage('--output-root must stay inside this repository')
}

const keyBytes = randomBytes(32)
const ivBytes = randomBytes(12)
const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
const envelope = JSON.stringify({
  version: 1,
  createdAt: new Date().toISOString(),
  expiresAt,
  document: source,
})
const ciphertext = await webcrypto.subtle.encrypt(
  { name: 'AES-GCM', iv: ivBytes, tagLength: 128 },
  key,
  new TextEncoder().encode(envelope),
)

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, renderEncryptedShell({
  ciphertext: toBase64Url(ciphertext),
  iv: toBase64Url(ivBytes),
}), { encoding: 'utf8', flag: 'wx' })

const siteUrl = options.siteUrl.replace(/\/+$/, '')
const publishedDirectory = path.posix.dirname(relativeOutput.split(path.sep).join('/'))
const shareUrl = `${siteUrl}/${publishedDirectory}/#k=${toBase64Url(keyBytes)}`
process.stdout.write(`${JSON.stringify({
  output: relativeOutput,
  shareUrl,
  expiresAt,
}, null, 2)}\n`)
