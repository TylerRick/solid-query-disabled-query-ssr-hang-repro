# `useQuery({ enabled: false })` never lets an SSR render finish (solid-query 6.0.0-rc.1)

> **Filed upstream as [TanStack/query#11348](https://github.com/TanStack/query/issues/11348)** — go
> there for the discussion, any maintainer response, and the current status. This repo is only the
> runnable reproduction.

A `useQuery` with `enabled: false`, whose `.data` is read during render, stops an SSR render from
ever finishing at `@tanstack/solid-query` 6.0.0-rc.1. It completes at 6.0.0-rc.0 with
`@tanstack/query-core` held at the same version, and completes at rc.1 when the query is enabled.

This is **pure Solid SSR** — `renderToStream`, one `QueryClientProvider`, one `useQuery`. No router,
no solid-start, no metaframework, no `<Loading>` boundary.

## Run it

```sh
pnpm install
ENABLED=0 node render.mjs   # SUBJECT — disabled query
ENABLED=1 node render.mjs   # CONTROL — same code, enabled query
```

`render.mjs` drives `@solidjs/web`'s `renderToStream` through vite's SSR loader and reports whether
the stream ever finishes, with an 8 second cap. No browser and no HTTP server involved.

## What happens

```
ENABLED=0  →  RESULT: HANG — stream did not finish in 8s (bytes so far: 0)
ENABLED=1  →  RESULT: COMPLETED — 347 bytes; out=id="out">data:
```

| solid-query | `enabled` | result                                    |
| ----------- | --------- | ----------------------------------------- |
| 6.0.0-rc.1  | `false`   | **HANG** — stream never finishes, 0 bytes |
| 6.0.0-rc.1  | `true`    | COMPLETED                                 |
| 6.0.0-rc.0  | `false`   | COMPLETED                                 |

Note the byte count on the hang: **zero**. Nothing is emitted at all, so the render is stuck before
anything is written rather than stalling mid-stream.

`@tanstack/query-core` is pinned to **5.101.4** in all three rows — rc.1's own exact dependency — via
both a direct dependency and a `pnpm.overrides` entry, so the query-core bump that normally rides
along with rc.1 is held constant. The only thing that moves is `solid-query`.

For the rc.0 row, set `@tanstack/solid-query` to `6.0.0-rc.0` in `package.json`, leave the query-core
override at 5.101.4, and `pnpm install`.

## Same symptom as the closed v5 issue #10907

[TanStack/query#10907](https://github.com/TanStack/query/issues/10907) reported
`useQuery({ enabled: false })` hanging `renderToStringAsync` on v5, with the same read-`.data`-during
-render trigger. There the cause was `useBaseQuery` forcing `experimental_prefetchInRender`, so a
disabled query's promise never resolved. It was closed with "experimental_prefetchInRender has been
removed", and the strip-the-promise PR
[#10923](https://github.com/TanStack/query/pull/10923) was closed unmerged.

So this is the same user-visible failure returning on the v6 rc line through a different
implementation — which is why [#11348](https://github.com/TanStack/query/issues/11348) is a new issue
rather than a comment on #10907.

## Mechanism

In [packages/solid-query/src/useBaseQuery.ts](https://github.com/TanStack/query/blob/2222f61f9b718e41d53a2eabc8b81999b248c04e/packages/solid-query/src/useBaseQuery.ts), `computeData()` — the derive of the single
`createProjection` that is the data node — ends:

```ts
if (state.data !== undefined) return wrap(state.data)

// Pending-idle: nothing in flight, nothing cached. …
if (isEnabled()) {
  …
  return chainOnce(q.fetch(opts as any), select, wrap)
}
return NEVER
```

where [`const NEVER: Promise<never> = new Promise(noop)`](https://github.com/TanStack/query/blob/2222f61f9b718e41d53a2eabc8b81999b248c04e/packages/solid-query/src/useBaseQuery.ts#L38) can never settle. Its docblock
([L30-L38](https://github.com/TanStack/query/blob/2222f61f9b718e41d53a2eabc8b81999b248c04e/packages/solid-query/src/useBaseQuery.ts#L30-L38)) states the parking is intentional client behaviour: it suspends the
reader into the nearest `<Loading>` until the query starts fetching, "at which point the version bump
re-runs the compute".

On the server there is no later: the render has to finish, and nothing will enable the query or write
the cache before it does. The three earlier `return NEVER` guards are each gated
([`!isServer && hydrating`](https://github.com/TanStack/query/blob/2222f61f9b718e41d53a2eabc8b81999b248c04e/packages/solid-query/src/useBaseQuery.ts#L497), [`!primed()`](https://github.com/TanStack/query/blob/2222f61f9b718e41d53a2eabc8b81999b248c04e/packages/solid-query/src/useBaseQuery.ts#L509), [`isRestoring()`](https://github.com/TanStack/query/blob/2222f61f9b718e41d53a2eabc8b81999b248c04e/packages/solid-query/src/useBaseQuery.ts#L519))
and `observer.setOptions` is gated `!isServer` — but the final disabled
[`return NEVER`](https://github.com/TanStack/query/blob/2222f61f9b718e41d53a2eabc8b81999b248c04e/packages/solid-query/src/useBaseQuery.ts#L534) has no `isServer` branch.

Permalinks are pinned to the `@tanstack/solid-query@6.0.0-rc.1` tag, commit `2222f61f9b71`, whose
`src/` is byte-identical to the published tarball.

## Environment

```
@tanstack/solid-query  6.0.0-rc.1
@tanstack/query-core   5.101.4   (pinned in every row)
solid-js               2.0.0-rc.4
@solidjs/web           2.0.0-rc.4
@solidjs/vite-plugin   3.0.0-next.35
@solidjs/compiler      2.0.0-rc.4
@solidjs/babel-plugin  2.0.0-rc.4
vite                   8.2.1
node                   24.19.0
```

## How it was found

Upgrading a real app to Solid 2.0.0-rc.4, where every page hung: a hook in the root chrome gates its
query with `enabled` on data only some routes provide, so on every other route that query is
disabled. Through TanStack Start the visible effect is that the SSR-query integration's `queryStream`
never closes, because `router.serverSsr.onRenderFinished(...)` is never reached — but as this repo
shows, the router is not needed to reproduce it.
