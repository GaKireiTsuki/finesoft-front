<script setup lang="ts">
import type { Action } from "@finesoft/front";
import type { AboutPage } from "../lib/models/product";

const { page, onAction: _onAction } = defineProps<{
    page: AboutPage;
    onAction?: (action: Action) => void;
}>();
</script>

<template>
    <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.content }}</p>
    </div>
</template>
