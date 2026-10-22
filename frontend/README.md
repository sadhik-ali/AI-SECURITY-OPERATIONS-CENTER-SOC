# frontend — React SOC console

Eight pages on a dark SOC theme, driven by one internally consistent synthetic
corpus so the interface is fully explorable with no backend running.

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run build        # production bundle in dist/
```

Sign in with `analyst@aisoc.dev` or `admin@aisoc.dev`, password `SocDemo!23`.

| Path | Owns |
| --- | --- |
| `src/pages/` | the eight route components + `Login` |
| `src/components/layout/` | `AppShell`, `Sidebar`, `Topbar`, `MobileNav`, nav config |
| `src/components/ui/` | `Panel`, badges, `RiskGauge`, `Drawer`, controls, loading/empty/error states |
| `src/components/charts/` | Recharts trend, severity donut, top sources |
| `src/services/` | `api` (axios), `auth`, `ws`, `mockStore`, `aiLocal` |
| `src/context/` | `AuthContext`, `LiveContext` (WebSocket + polling fallback) |
| `src/data/` | the synthetic world: hosts, accounts, events, alerts, incidents |
| `src/types/api.ts` | mirrors the backend schemas — drift becomes a compile error |
| `src/hooks/`, `src/lib/` | `useAsync`, formatting, seeded RNG |

**Data source switch** — `src/services/api.ts` reads `VITE_DATA_SOURCE`:

| Value | Behaviour |
| --- | --- |
| `mock` (default) | bundled synthetic store; no backend needed |
| `api` | real backend over `/api` and `/ws`, proxied by Vite to `:8000` |

The mock store implements the same shapes as the API client, so switching is a
transport change rather than a page rewrite — that is the Phase 3 seam.

The AI Assistant page is a **deterministic responder** over the incident's own
evidence and says so on screen. No fabricated model calls.

Stack: React 18 · Vite 6 · TypeScript · Tailwind (custom `soc-*` palette) ·
Recharts · Lucide · Axios · react-router-dom v6.

Deployment: multi-stage build → nginx, which serves the SPA and proxies `/api` and
`/ws` with `Upgrade` headers. See [`nginx.conf`](nginx.conf) and
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
