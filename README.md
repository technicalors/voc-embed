# @technicalors/voc-embed

Mount the **VOC** portal in a host frontend (VOC Integration Protocol v1).

- Fetches a short-lived session from the host backend ([`technicalors/voc-laravel`](https://github.com/technicalors/voc-laravel) exposes `GET /api/voc/session`).
- Creates a sandboxed iframe at `{portal_url}{route}?client={client_key}`.
- Answers the postMessage handshake: hands the token to the portal on `voc.portal.ready` and refreshes it on `voc.portal.token-expiring`.
- Resizes the iframe to its content and reports navigation, unread count and errors.

Zero runtime dependencies. A Vue 3 component and composable ship in `@technicalors/voc-embed/vue`.

## Install

Until the package is published to npm, install the tarball attached to a GitHub Release:

```bash
pnpm add https://github.com/technicalors/voc-embed/releases/download/v0.1.1/technicalors-voc-embed-0.1.1.tgz
```

## Vue usage

The host keeps using its own authenticated HTTP client. `getSession` may resolve to the JSON body or to an axios-style response (`{ data }`); snake_case and camelCase keys are both accepted.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { VocPortal } from '@technicalors/voc-embed/vue'
import { requestClient } from '#/api/request'

const route = ref('/tickets')
</script>

<template>
  <VocPortal
    :get-session="() => requestClient.get('/voc/session')"
    :route="route"
    locale="vi"
    theme="light"
    :min-height="640"
    @navigate="(next) => (route = next)"
    @error="(code) => console.warn('VOC portal error', code)"
  />
</template>
```

Unread badge in the host menu, polling `GET /api/voc/unread-count` every minute:

```vue
<script setup lang="ts">
import { useVocUnread } from '@technicalors/voc-embed/vue'
import { requestClient } from '#/api/request'

const unread = useVocUnread(() => requestClient.get('/voc/unread-count'))
</script>

<template>
  <span v-if="unread > 0" class="badge">{{ unread }}</span>
</template>
```

When the portal reports `token-expiring`, `getSession` is called with `{ refresh: true }`. Forward it so the backend skips its session cache:

```ts
const getSession = ({ refresh }: { refresh: boolean }) =>
  requestClient.get('/voc/session', { params: refresh ? { refresh: 1 } : {} })
```

Without it the backend still returns a new token once the cached one is within 5 minutes of expiry, which is when the portal asks.

### `VocPortal` props and events

| Prop | Type | Default |
| --- | --- | --- |
| `getSession` (required) | `(request: { refresh: boolean }) => Promise<VocSessionLike>` | |
| `route` | `string` (`/tickets`, `/tickets/new`, `/tickets/{id}`, `/tickets/{id}/edit`, `/notifications`) | `/tickets` |
| `locale` | `vi`, `en`, `ko` (regional tags such as `vi-VN` are reduced) | portal default |
| `theme` | `light`, `dark` | portal default |
| `minHeight` | `number` (px) | `600` |
| `title` | iframe title | `VOC` |

`route`, `locale`, `theme` and `minHeight` are reactive and applied without reloading the iframe. Pass the height of the host content area as `minHeight` to make the portal fill the screen; the iframe still grows when the portal content is taller.

| Event | Payload |
| --- | --- |
| `navigate` | `route: string`, the portal route after in-portal navigation |
| `unread` | `count: number` |
| `error` | `code: 'origin_not_allowed' \| 'auth_failed' \| 'client_unknown' \| 'session_failed'`, `cause?: unknown` |

The component exposes `navigate(route)` through a template ref.

### `useVocUnread(fetchCount, intervalMs = 60000)`

Returns a `Ref<number>`. Polls immediately and then every `intervalMs` while the page is visible, polls again when the tab becomes visible, keeps the last value when a poll fails, and stops when the calling component unmounts. `fetchCount` may resolve to a number, `{ count }` or `{ data: { count } }`.

## Framework-free usage

```ts
import { mountVocPortal } from '@technicalors/voc-embed'

const portal = mountVocPortal(document.getElementById('voc')!, {
  getSession: ({ refresh }) =>
    fetch(`/api/voc/session${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
  route: '/tickets',
  locale: 'vi',
  onNavigate: (route) => history.replaceState(null, '', `#${route}`),
  onUnreadChange: (count) => updateBadge(count),
  onError: (code, cause) => console.warn(code, cause),
})

portal.navigate('/tickets/123')
portal.setLocale('en')
portal.setTheme('dark')
portal.setMinHeight(720)
portal.destroy()
```

## Errors

| Code | Source | Meaning |
| --- | --- | --- |
| `session_failed` | this package | `getSession` rejected (401, 403 for users without VOC ability, 502) or returned an invalid session. No iframe is mounted on the first load. |
| `auth_failed` | portal | The token was rejected. The package fetches a fresh session once and retries before reporting it. |
| `origin_not_allowed` | portal | The host origin is not in the VOC client's `allowed_origins`. |
| `client_unknown` | portal | `client_key` is unknown or the client is inactive. |

## Protocol

`@technicalors/voc-embed/protocol` exports the message types and type guards (`isVocPortalMessage`, `isVocParentMessage`, `isVocRoute`, ...). The same file is mirrored in VOC web; it has no imports.

| Direction | Type | Fields |
| --- | --- | --- |
| parent -> iframe | `voc.portal.auth` | `token`, `expires_at`, `locale?`, `theme?` |
| parent -> iframe | `voc.portal.navigate` | `route` |
| iframe -> parent | `voc.portal.ready` | |
| iframe -> parent | `voc.portal.authenticated` | |
| iframe -> parent | `voc.portal.token-expiring` | |
| iframe -> parent | `voc.portal.navigate` | `route` |
| iframe -> parent | `voc.portal.resize` | `height` |
| iframe -> parent | `voc.portal.unread` | `count` |
| iframe -> parent | `voc.portal.error` | `code` |

Every message carries `v: 1`.

## Security

- Messages are accepted only when `event.source` is the portal iframe window **and** `event.origin` is the origin of `portal_url`. Everything else is ignored.
- Messages are posted only to the portal origin, never to `*`.
- The iframe is sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`, `allow="clipboard-write"` and `referrerpolicy="strict-origin-when-cross-origin"`.
- `portal_url` must be `http(s)`, and routes must be absolute paths on the portal origin (`//host` and full URLs are refused).
- The token lives in memory only, in this package and in the portal. Do not persist the session response.
- VOC only allows framing from the client's `allowed_origins` (`Content-Security-Policy: frame-ancestors`).

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build      # dist/ (ESM, CJS, .d.ts); not committed
```

Pushing a `v*` tag that matches `package.json` runs the release workflow: typecheck, tests, build, `npm pack`, and attaches the tarball to the GitHub Release. Nothing is published to npm.

## License

MIT
