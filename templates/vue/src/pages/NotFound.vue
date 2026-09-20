<script setup lang="ts">
import type { ErrorPage } from "../lib/models/product";

const { page } = defineProps<{ page: ErrorPage }>();
</script>

<template>
    <section class="page page-error">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
        <a href="/">← Go Home</a>
    </section>
</template>
