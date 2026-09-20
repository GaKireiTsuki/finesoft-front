# Session restoration and multiple instances

Create embedded apps with `createBrowserApp({ definition, target, history: "memory", persistenceKey: "first", session: {}, domRestore: true })`. Each instance needs its own target and stable persistence key. Only one app per window may own browser history.

Mount the native App, then await `app.ready`. Session reading/restoration starts after the first native commit acknowledgement; Outlet's commit never waits for restore. Register React persistence providers in a layout effect, and Vue/Svelte providers during native mount. `app.session.register(provider)` returns an unregister callback. Provider capture/restore accesses native business state directly; no separate NameStore is required.

Hidden pages retain native instances. Pop removes the entry and scoped draft. DOM restoration handles explicitly marked fields and scroll within `data-restore-root`, bounded by the owning app. Instances do not capture one another's inputs.

`app.session.save()` and `clear()` return observable results. Adjacent unstarted implicit saves coalesce; explicit snapshots, load, restore and clear are ordered boundaries. Disposal captures the current state and waits for registered storage work. Browser shutdown still cannot guarantee an asynchronous write finishes.

Clean up with `try { await app.dispose(); } finally { nativeRoot.unmount(); }`, using Svelte's `unmount` function when applicable. Other instances can keep calling `other.navigation.navigate("/")`. Session protocol v2 uses a navigation tree; old URL-only snapshots are incompatible. Business slices retain independent versions and migration contracts.
