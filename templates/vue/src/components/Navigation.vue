<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
import { NAV_LINKS } from "../actions";

const { currentPath = "/", onAction } = defineProps<{
    currentPath?: string;
    onAction?: (action: Action) => void;
}>();

function handleClick(action: Action, event: MouseEvent) {
    if (
        !onAction ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return;
    }
    event.preventDefault();
    onAction(action);
}
</script>

<template>
    <nav class="navigation">
        <a
            v-for="link in NAV_LINKS"
            :key="link.label"
            :href="link.path ?? link.action.url"
            class="navigation-link"
            :class="{ active: link.path !== null && currentPath === link.path }"
            @click="handleClick(link.action, $event)"
        >
            {{ link.label }}
        </a>
    </nav>
</template>
