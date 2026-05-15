<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    data: unknown;
    label?: string;
}>();

const pretty = computed(() => {
    try {
        return JSON.stringify(props.data, replacer, 2);
    } catch (err) {
        return String(err);
    }
});

function replacer(_key: string, value: unknown): unknown {
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (value instanceof RegExp) return value.toString();
    if (value === undefined) return "(undefined)";
    return value;
}
</script>

<template>
    <div class="fs-json-wrap">
        <div v-if="label" class="fs-json-label">{{ label }}</div>
        <pre class="fs-json"><code>{{ pretty }}</code></pre>
    </div>
</template>

<style scoped>
.fs-json-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.fs-json-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vp-c-text-2);
}

.fs-json {
    margin: 0;
    background: var(--vp-c-bg);
    border: 1px solid var(--vp-c-divider);
    border-radius: 6px;
    padding: 0.75rem;
    font-family: var(--vp-font-family-mono);
    font-size: 0.78rem;
    overflow-x: auto;
    max-height: 360px;
}
</style>
