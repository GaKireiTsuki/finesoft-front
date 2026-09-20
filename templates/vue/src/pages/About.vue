<script setup lang="ts">
import type { AboutPage } from "../lib/models/product";

const { page } = defineProps<{
    page: AboutPage;
}>();
</script>

<template>
    <section class="page page-about">
        <h1>{{ page.title }}</h1>
        <p>{{ page.content }}</p>
    </section>
</template>
