<script setup lang="ts">
import { computed } from "vue";

interface TimelineStep {
    label: string;
    detail?: string;
}

const props = defineProps<{
    steps: TimelineStep[];
    active?: number;
}>();

const activeIndex = computed(() => props.active ?? -1);
</script>

<template>
    <ol class="fs-timeline">
        <li
            v-for="(step, idx) in steps"
            :key="idx"
            class="fs-timeline-step"
            :class="{ 'is-active': idx === activeIndex }"
        >
            <span class="dot" />
            <div>
                <div class="fs-timeline-label">{{ step.label }}</div>
                <div v-if="step.detail" class="fs-timeline-detail">{{ step.detail }}</div>
            </div>
        </li>
    </ol>
</template>

<style scoped>
.fs-timeline-label {
    font-size: 0.85rem;
    font-weight: 500;
}

.fs-timeline-detail {
    font-size: 0.75rem;
    color: var(--vp-c-text-2);
    margin-top: 2px;
}
</style>
