<script setup lang="ts">
import { Router, type RouteMatch } from "@finesoft/core";
import { computed, ref } from "vue";
import { sampleRoutes, sampleUrls } from "../fixtures/sample-routes";
import JsonInspector from "../primitives/JsonInspector.vue";

const router = (() => {
    const r = new Router();
    for (const route of sampleRoutes) {
        r.add(route.pattern, route.intentId, route.options);
    }
    return r;
})();

const url = ref("/products/42?ref=email");
const customMode = ref(false);

const match = computed<RouteMatch | null>(() => {
    if (!url.value) return null;
    return router.resolve(url.value);
});

const matchPretty = computed(() => {
    if (!match.value) return null;
    const { intent, action, renderMode } = match.value;
    return {
        intent: { id: intent.id, params: { ...intent.params } },
        action: { kind: action.kind, url: action.url },
        renderMode: renderMode ?? "(default)",
    };
});

const matchedRoute = computed(() => {
    if (!match.value) return null;
    return sampleRoutes.find((r) => r.intentId === match.value!.intent.id) ?? null;
});

function pickUrl(u: string) {
    customMode.value = false;
    url.value = u;
}
</script>

<template>
    <ClientOnly>
        <div class="fs-demo">
            <div class="fs-demo-title">Demo · Router.resolve()</div>

            <div class="fs-demo-grid">
                <div class="fs-demo-controls">
                    <label>
                        URL to resolve
                        <input
                            v-model="url"
                            type="text"
                            spellcheck="false"
                            placeholder="/products/42"
                            @input="customMode = true"
                        />
                    </label>

                    <div>
                        <div class="quick-label">Try:</div>
                        <div class="quick-row">
                            <button
                                v-for="u in sampleUrls"
                                :key="u"
                                type="button"
                                class="secondary chip"
                                :class="{ active: !customMode && u === url }"
                                @click="pickUrl(u)"
                            >
                                {{ u }}
                            </button>
                        </div>
                    </div>

                    <details>
                        <summary>Registered routes ({{ sampleRoutes.length }})</summary>
                        <ul class="route-list">
                            <li v-for="r in sampleRoutes" :key="r.pattern">
                                <code>{{ r.pattern }}</code>
                                → <code>{{ r.intentId }}</code>
                                <span class="rm">[{{ r.options?.renderMode }}]</span>
                            </li>
                        </ul>
                    </details>
                </div>

                <div>
                    <div v-if="!match" class="fs-demo-empty">
                        No route matched <code>{{ url }}</code
                        >. <code>Router.resolve()</code> returned <code>null</code>.
                    </div>
                    <template v-else>
                        <JsonInspector :data="matchPretty" label="RouteMatch" />
                        <div v-if="matchedRoute?.note" class="note">
                            <strong>Note:</strong> {{ matchedRoute.note }}
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </ClientOnly>
</template>

<style scoped>
.quick-label {
    font-size: 0.75rem;
    color: var(--vp-c-text-2);
    margin-bottom: 0.35rem;
}

.quick-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.chip {
    padding: 0.2rem 0.55rem !important;
    font-size: 0.72rem !important;
    font-family: var(--vp-font-family-mono);
}

.chip.active {
    background: var(--vp-c-brand-soft) !important;
    border-color: var(--vp-c-brand-1) !important;
}

.route-list {
    list-style: none;
    padding: 0.5rem 0 0;
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.7;
}

.route-list code {
    font-size: 0.75rem;
}

.rm {
    color: var(--vp-c-text-3);
    font-family: var(--vp-font-family-mono);
    font-size: 0.7rem;
    margin-left: 0.25rem;
}

.note {
    margin-top: 0.6rem;
    padding: 0.5rem 0.75rem;
    background: var(--vp-c-bg);
    border-left: 3px solid var(--vp-c-brand-1);
    border-radius: 4px;
    font-size: 0.8rem;
    color: var(--vp-c-text-2);
}
</style>
