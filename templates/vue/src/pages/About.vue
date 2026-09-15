<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
import type { AboutPage } from "../lib/models/product";

const { page } = defineProps<{
    page: AboutPage;
    onAction?: (action: Action) => void;
}>();
</script>

<template>
    <section class="page page-about">
        <h1>{{ page.title }}</h1>
        <p>{{ page.content }}</p>
    </section>
</template>
