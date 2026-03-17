<script setup lang="ts">
import type { Action } from "@finesoft/front";
import Navigation from "./Navigation.vue";

const { currentPath = "/", onAction } = defineProps<{
    currentPath?: string;
    onAction?: (action: Action) => void;
}>();
</script>

<template>
    <div>
        <Navigation :current-path="currentPath" :on-action="onAction" />
        <main style="padding: 1rem">
            <slot />
        </main>
    </div>
</template>
