<script setup lang="ts">
interface PipelineStage {
    id: string;
    label: string;
    sublabel?: string;
}

defineProps<{
    stages: PipelineStage[];
    active?: string | null;
    terminated?: string | null;
}>();
</script>

<template>
    <div class="fs-pipeline">
        <template v-for="(stage, idx) in stages" :key="stage.id">
            <div
                class="fs-pipeline-stage"
                :class="{
                    'is-active': stage.id === active,
                    'is-terminated': stage.id === terminated,
                }"
            >
                <div class="label">{{ stage.label }}</div>
                <div v-if="stage.sublabel" class="sublabel">{{ stage.sublabel }}</div>
            </div>
            <div v-if="idx < stages.length - 1" class="fs-pipeline-arrow">→</div>
        </template>
    </div>
</template>

<style scoped>
.label {
    font-weight: 500;
}

.sublabel {
    font-size: 0.7rem;
    color: var(--vp-c-text-2);
    margin-top: 2px;
}
</style>
