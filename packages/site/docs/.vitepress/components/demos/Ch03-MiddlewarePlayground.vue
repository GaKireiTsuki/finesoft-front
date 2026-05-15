<script setup lang="ts">
import {
    deny,
    next,
    redirect,
    rewrite,
    runBeforeLoadGuards,
    type BeforeLoadGuard,
    type MiddlewareResult,
    type NavigationContext,
} from "@finesoft/core";
import { computed, reactive, ref } from "vue";
import Pipeline from "../primitives/Pipeline.vue";

type GuardKind = "next" | "redirect" | "rewrite" | "deny";

interface GuardConfig {
    id: string;
    label: string;
    kind: GuardKind;
}

const guards = reactive<GuardConfig[]>([
    { id: "auth", label: "auth", kind: "next" },
    { id: "i18n", label: "i18n", kind: "next" },
    { id: "abtest", label: "abtest", kind: "next" },
]);

const url = ref("/account/orders");
const cookieAuth = ref("token=guest");

const stages = computed(() => [
    { id: "start", label: "URL", sublabel: url.value },
    ...guards.map((g) => ({ id: g.id, label: g.label, sublabel: g.kind })),
    { id: "controller", label: "controller", sublabel: "(would run)" },
    { id: "afterLoad", label: "afterLoad", sublabel: "(skipped here)" },
    { id: "render", label: "render", sublabel: "(skipped)" },
]);

const lastResult = ref<MiddlewareResult | null>(null);
const lastTrace = ref<{ guardId: string; result: MiddlewareResult }[]>([]);
const activeStage = ref<string | null>(null);
const terminatedStage = ref<string | null>(null);
const isRunning = ref(false);

function makeContext(): NavigationContext {
    return {
        url: url.value,
        path: url.value.split("?")[0],
        params: {},
        intent: { id: "demo.intent", params: {} },
        isServer: false,
        container: {} as never,
        getCookie: (name: string) => {
            const m = cookieAuth.value.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
            return m?.[1];
        },
        getHeader: () => undefined,
    };
}

function makeGuard(cfg: GuardConfig): BeforeLoadGuard {
    return async () => {
        switch (cfg.kind) {
            case "next":
                return next();
            case "redirect":
                return redirect("/login", 302);
            case "rewrite":
                return rewrite("/products");
            case "deny":
                return deny(403, "Forbidden");
        }
    };
}

async function runChain() {
    if (isRunning.value) return;
    isRunning.value = true;
    lastResult.value = null;
    lastTrace.value = [];
    terminatedStage.value = null;
    activeStage.value = "start";
    await sleep(450);

    const ctx = makeContext();
    let terminated = false;

    for (const cfg of guards) {
        activeStage.value = cfg.id;
        await sleep(500);

        const guard = makeGuard(cfg);
        const result = await guard(ctx);
        lastTrace.value = [...lastTrace.value, { guardId: cfg.id, result }];

        if (result.kind !== "next") {
            terminatedStage.value = cfg.id;
            lastResult.value = result;
            terminated = true;
            break;
        }
    }

    if (!terminated) {
        // Use the real pipeline runner to confirm the same outcome
        const final = await runBeforeLoadGuards(guards.map(makeGuard), ctx);
        lastResult.value = final;

        for (const stage of ["controller", "afterLoad", "render"] as const) {
            activeStage.value = stage;
            await sleep(420);
        }
    }

    activeStage.value = null;
    isRunning.value = false;
}

function reset() {
    lastResult.value = null;
    lastTrace.value = [];
    activeStage.value = null;
    terminatedStage.value = null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

const traceFormatted = computed(() => {
    return lastTrace.value.map((t) => {
        const r = t.result;
        let summary = r.kind;
        if (r.kind === "redirect") summary = `redirect → ${r.url} (${r.status})`;
        else if (r.kind === "rewrite") summary = `rewrite → ${r.url}`;
        else if (r.kind === "deny") summary = `deny ${r.status}: ${r.message}`;
        return { guard: t.guardId, summary };
    });
});
</script>

<template>
    <ClientOnly>
        <div class="fs-demo">
            <div class="fs-demo-title">Demo · runBeforeLoadGuards()</div>

            <div class="fs-demo-grid">
                <div class="fs-demo-controls">
                    <label>
                        Request URL
                        <input v-model="url" type="text" spellcheck="false" />
                    </label>

                    <label>
                        Cookie header
                        <input v-model="cookieAuth" type="text" spellcheck="false" />
                    </label>

                    <div class="guards">
                        <div class="guards-label">Guard chain (in order):</div>
                        <div v-for="g in guards" :key="g.id" class="guard-row">
                            <span class="guard-name">{{ g.label }}</span>
                            <select v-model="g.kind">
                                <option value="next">next()</option>
                                <option value="redirect">redirect("/login", 302)</option>
                                <option value="rewrite">rewrite("/products")</option>
                                <option value="deny">deny(403, "Forbidden")</option>
                            </select>
                        </div>
                    </div>

                    <div class="actions">
                        <button :disabled="isRunning" @click="runChain">
                            {{ isRunning ? "Running…" : "▶ Run chain" }}
                        </button>
                        <button class="secondary" :disabled="isRunning" @click="reset">
                            Reset
                        </button>
                    </div>
                </div>

                <div>
                    <Pipeline
                        :stages="stages"
                        :active="activeStage"
                        :terminated="terminatedStage"
                    />

                    <div v-if="lastTrace.length" class="trace">
                        <div class="trace-title">Trace</div>
                        <ol>
                            <li v-for="(t, i) in traceFormatted" :key="i">
                                <code>{{ t.guard }}</code>
                                →
                                <code>{{ t.summary }}</code>
                            </li>
                        </ol>
                    </div>

                    <div v-if="lastResult" class="result" :class="`r-${lastResult.kind}`">
                        Final: <code>{{ lastResult.kind }}</code>
                        <template v-if="lastResult.kind === 'redirect'">
                            → <code>{{ lastResult.url }}</code> ({{ lastResult.status }})
                        </template>
                        <template v-else-if="lastResult.kind === 'rewrite'">
                            → <code>{{ lastResult.url }}</code>
                        </template>
                        <template v-else-if="lastResult.kind === 'deny'">
                            <code>{{ lastResult.status }} {{ lastResult.message }}</code>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </ClientOnly>
</template>

<style scoped>
.guards {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.guards-label {
    font-size: 0.75rem;
    color: var(--vp-c-text-2);
}

.guard-row {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 0.5rem;
    align-items: center;
}

.guard-name {
    font-family: var(--vp-font-family-mono);
    font-size: 0.78rem;
    color: var(--vp-c-brand-1);
}

.actions {
    display: flex;
    gap: 0.5rem;
}

.trace {
    margin-top: 0.85rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--vp-c-divider);
    border-radius: 6px;
    background: var(--vp-c-bg);
}

.trace-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vp-c-text-2);
    margin-bottom: 0.25rem;
}

.trace ol {
    margin: 0;
    padding-left: 1.2rem;
    font-size: 0.78rem;
    line-height: 1.6;
}

.result {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--vp-c-divider);
    font-size: 0.85rem;
}

.r-next {
    background: color-mix(in oklab, var(--vp-c-brand-1) 8%, transparent);
    border-color: var(--vp-c-brand-1);
}

.r-redirect,
.r-rewrite {
    background: color-mix(in oklab, #ffb84d 12%, transparent);
    border-color: #ffb84d;
}

.r-deny {
    background: color-mix(in oklab, #e74c3c 10%, transparent);
    border-color: #e74c3c;
}
</style>
