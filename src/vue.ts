import {
  type PropType,
  type Ref,
  defineComponent,
  getCurrentScope,
  h,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  ref,
  watch,
} from 'vue'
import { type VocEmbedErrorCode, type VocPortalHandle, mountVocPortal } from './portal'
import type { VocTheme } from './protocol'
import type { VocSessionLike, VocSessionRequest } from './session'

/**
 * Vue 3 wrapper of `mountVocPortal`. Props are reactive: changing `route`, `locale` or `theme`
 * updates the mounted portal without reloading it.
 */
export const VocPortal = defineComponent({
  name: 'VocPortal',
  props: {
    getSession: {
      type: Function as PropType<(request: VocSessionRequest) => Promise<VocSessionLike>>,
      required: true,
    },
    route: { type: String, default: undefined },
    locale: { type: String, default: undefined },
    theme: { type: String as PropType<VocTheme>, default: undefined },
    minHeight: { type: Number, default: undefined },
    title: { type: String, default: undefined },
  },
  emits: {
    navigate: (route: string) => typeof route === 'string',
    unread: (count: number) => typeof count === 'number',
    error: (code: VocEmbedErrorCode, _cause?: unknown) => typeof code === 'string',
  },
  setup(props, { emit, expose }) {
    const container = ref<HTMLElement | null>(null)
    let portal: VocPortalHandle | null = null
    let currentRoute = props.route

    onMounted(() => {
      if (container.value === null) {
        return
      }

      portal = mountVocPortal(container.value, {
        getSession: (request) => props.getSession(request),
        route: props.route,
        locale: props.locale,
        theme: props.theme,
        minHeight: props.minHeight,
        title: props.title,
        onNavigate: (route) => {
          currentRoute = route
          emit('navigate', route)
        },
        onUnreadChange: (count) => emit('unread', count),
        onError: (code, cause) => emit('error', code, cause),
      })
    })

    watch(
      () => props.route,
      (route) => {
        if (route !== undefined && route !== currentRoute) {
          currentRoute = route
          portal?.navigate(route)
        }
      },
    )
    watch(
      () => props.locale,
      (locale) => {
        if (locale !== undefined) {
          portal?.setLocale(locale)
        }
      },
    )
    watch(
      () => props.minHeight,
      (minHeight) => {
        if (minHeight !== undefined) {
          portal?.setMinHeight(minHeight)
        }
      },
    )
    watch(
      () => props.theme,
      (theme) => {
        if (theme !== undefined) {
          portal?.setTheme(theme)
        }
      },
    )

    onBeforeUnmount(() => {
      portal?.destroy()
      portal = null
    })

    expose({
      navigate: (route: string) => portal?.navigate(route),
    })

    return () => h('div', { ref: container, class: 'voc-portal' })
  },
})

/** Result accepted from `fetchCount`: a number, the `{count}` body of `GET /api/voc/unread-count`, or an axios-style response. */
export type VocUnreadResult = number | { count: number } | { data: { count: number } }

function toCount(result: VocUnreadResult): number | null {
  const value = typeof result === 'number' ? result : 'count' in result ? result.count : result.data.count

  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Polls the unread count (immediately, then every `intervalMs`) while the page is visible.
 * Failed polls keep the last value. Polling stops when the calling scope (component) is disposed.
 */
export function useVocUnread(fetchCount: () => Promise<VocUnreadResult>, intervalMs = 60_000): Ref<number> {
  const count = ref(0)
  let inFlight = false

  const poll = async (): Promise<void> => {
    if (inFlight || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
      return
    }

    inFlight = true
    try {
      const next = toCount(await fetchCount())
      if (next !== null) {
        count.value = next
      }
    } catch {
      return
    } finally {
      inFlight = false
    }
  }

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      void poll()
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), Math.max(1_000, intervalMs))
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearInterval(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
      }
    })
  }

  return count
}

export type { VocEmbedErrorCode, VocPortalHandle, VocPortalOptions } from './portal'
export type { VocSession, VocSessionLike, VocSessionRequest } from './session'
