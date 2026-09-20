import { cloneSnapshotValue, decodeSnapshot, encodeSnapshot } from "./snapshot";
import { createNavigationScopedState } from "./scoped-state";
import {
    SESSION_DEFAULT_KEY,
    SESSION_DEFAULT_VERSION,
    SessionError,
    StorageUnavailableError,
} from "./types";
import type {
    NavigationScopedState,
    SessionErrorContext,
    SessionFailure,
    SessionLoadResult,
    SessionRestoreResult,
    SessionSlice,
    SessionSnapshot,
    SessionStateProvider,
    SessionStore,
    SessionStoreOptions,
    SessionWriteResult,
} from "./types";

/** One ordered persistence owner; implicit saves capture when their queue slot starts. */
export function createSessionStore(options: SessionStoreOptions): SessionStore {
    const {
        storage,
        key = SESSION_DEFAULT_KEY,
        version = SESSION_DEFAULT_VERSION,
        maxAgeMs,
        navigation,
        now = () => Date.now(),
        onError,
    } = options;
    const providers = new Map<string, SessionStateProvider>();
    let scope: NavigationScopedState = createNavigationScopedState();
    let queue = Promise.resolve();
    let closed = false;
    let queuedImplicit:
        | { readonly result: Promise<SessionWriteResult>; started: boolean }
        | undefined;
    function report(ctx: SessionErrorContext): void {
        // Never forward arbitrary decoder/storage exceptions into default diagnostics.
        try {
            onError?.(new SessionError(ctx.code ?? "session-failed"), ctx);
        } catch {
            /* observer isolation */
        }
    }
    function failure(cause: unknown, phase: SessionErrorContext["phase"]): SessionFailure {
        const unavailable = cause instanceof StorageUnavailableError;
        report({ phase, code: unavailable ? "storage-unavailable" : "storage-failed" });
        return unavailable ? { status: "unavailable" } : { status: "failed", cause };
    }
    function enqueue<T>(
        work: () => Promise<T>,
        implicit = false,
    ): Promise<T | { status: "closed" }> {
        if (closed) return Promise.resolve({ status: "closed" });
        if (!implicit) queuedImplicit = undefined;
        let slot: { result: Promise<SessionWriteResult>; started: boolean } | undefined;
        const result = queue.then(async () => {
            if (slot) {
                slot.started = true;
                if (queuedImplicit === slot) queuedImplicit = undefined;
            }
            return work();
        });
        queue = result.then(
            () => {},
            () => {},
        );
        if (implicit) {
            slot = { result: result as Promise<SessionWriteResult>, started: false };
            queuedImplicit = slot;
        }
        return result;
    }
    function capture(): SessionSnapshot {
        const slices: Record<string, SessionSlice> = Object.create(null);
        for (const provider of providers.values()) {
            try {
                slices[provider.key] = {
                    version: provider.version,
                    data: cloneSnapshotValue(provider.capture()),
                };
            } catch {
                report({ phase: "capture", key: provider.key, code: "slice-failed" });
            }
        }
        const scoped = cloneSnapshotValue(
            Object.fromEntries(scope.keys().map((id) => [id, scope.get(id)])),
        );
        return {
            version,
            navigation: cloneSnapshotValue(navigation?.capture()),
            url: navigation?.captureUrl?.(),
            slices,
            scoped,
            capturedAt: now(),
        };
    }
    async function read(): Promise<SessionLoadResult> {
        try {
            const raw = await storage.get(key);
            if (raw === undefined) return { status: "missing" };
            const snapshot = decodeSnapshot(raw, version);
            if (!snapshot) return { status: "invalid" };
            if (maxAgeMs !== undefined && now() - snapshot.capturedAt > maxAgeMs)
                return { status: "expired" };
            return { status: "loaded", snapshot };
        } catch (cause) {
            return failure(cause, "load");
        }
    }
    function persist(snapshot?: SessionSnapshot): Promise<SessionWriteResult> {
        if (closed) return Promise.resolve({ status: "closed" });
        if (snapshot === undefined) {
            // Coalesce only the final queued, not-yet-started implicit write. Capture happens in that slot.
            if (queuedImplicit && !queuedImplicit.started) return queuedImplicit.result;
            return enqueue(async () => {
                try {
                    await storage.set(key, encodeSnapshot(capture()));
                    return { status: "saved" as const };
                } catch (cause) {
                    return failure(cause, "persist");
                }
            }, true) as Promise<SessionWriteResult>;
        }
        // Explicit values are admitted at call time and always form a queue boundary, even on encode failure.
        let admitted: string | undefined;
        let rejected: SessionFailure | undefined;
        try {
            admitted = encodeSnapshot(cloneSnapshotValue(snapshot));
        } catch (cause) {
            rejected = failure(cause, "persist");
        }
        return enqueue(async () => {
            if (rejected) return rejected;
            try {
                await storage.set(key, admitted!);
                return { status: "saved" as const };
            } catch (cause) {
                return failure(cause, "persist");
            }
        }) as Promise<SessionWriteResult>;
    }
    return {
        register(provider): () => void {
            if (closed) throw new SessionError("session-closed");
            if (providers.has(provider.key)) throw new SessionError("duplicate-provider-key");
            if (
                !provider.key ||
                !Number.isInteger(provider.version) ||
                provider.version < 1 ||
                typeof provider.decode !== "function"
            )
                throw new SessionError("invalid-provider-schema");
            providers.set(provider.key, provider);
            return () => {
                if (providers.get(provider.key) === provider) providers.delete(provider.key);
            };
        },
        get scope() {
            return scope;
        },
        capture,
        persist,
        save: () => persist(),
        load: () => enqueue(read),
        restore(snapshot): Promise<SessionRestoreResult> {
            return enqueue(async () => {
                if (snapshot === undefined) {
                    const loaded = await read();
                    if (loaded.status !== "loaded") return loaded;
                    snapshot = loaded.snapshot;
                }
                // Direct restore calls pass the same decoder boundary as persisted input.
                let valid: SessionSnapshot | undefined;
                try {
                    valid = decodeSnapshot(encodeSnapshot(snapshot), version);
                } catch {
                    /* invalid */
                }
                if (!valid) {
                    report({ phase: "restore", code: "navigation-invalid" });
                    return { status: "invalid" };
                }
                try {
                    await navigation?.apply(valid.navigation);
                } catch (cause) {
                    report({ phase: "restore", code: "navigation-invalid" });
                    return { status: "failed", cause };
                }
                scope = createNavigationScopedState({ ...valid.scoped });
                const discarded: string[] = [];
                for (const provider of providers.values()) {
                    if (!Object.hasOwn(valid.slices, provider.key)) continue;
                    const slice = valid.slices[provider.key] as Partial<SessionSlice> | null;
                    try {
                        if (
                            !slice ||
                            !Number.isInteger(slice.version) ||
                            (slice.version !== provider.version && !provider.migrate)
                        ) {
                            discarded.push(provider.key);
                            report({
                                phase: "restore",
                                key: provider.key,
                                code: "slice-incompatible",
                            });
                            continue;
                        }
                        const data =
                            slice.version === provider.version
                                ? slice.data
                                : provider.migrate!(slice.data, slice.version!);
                        await provider.restore(provider.decode(data));
                    } catch {
                        discarded.push(provider.key);
                        report({ phase: "restore", key: provider.key, code: "slice-failed" });
                    }
                }
                return discarded.length ? { status: "partial", discarded } : { status: "restored" };
            });
        },
        clear: () =>
            enqueue(async () => {
                try {
                    await storage.delete(key);
                    return { status: "cleared" as const };
                } catch (cause) {
                    return failure(cause, "clear");
                }
            }),
        dispose(): Promise<void> {
            closed = true;
            return queue;
        },
    };
}
