<script setup lang="ts">
import type { Action } from "@finesoft/front";
import { NAV_ACTIONS } from "../actions";
import type { ErrorPage } from "../lib/models/product";

const { page, onAction } = defineProps<{ page: ErrorPage; onAction?: (action: Action) => void }>();

function handleHome(e: MouseEvent) {
    if (onAction) {
        e.preventDefault();
        onAction(NAV_ACTIONS.home);
    }
}
</script>

<template>
    <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <a href="/" @click="handleHome">← Go Home</a>
    </div>
</template>
