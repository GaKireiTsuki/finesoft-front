<script setup lang="ts">
import type { ProductPage } from "../lib/models/product";

const { page } = defineProps<{
    page: ProductPage;
}>();
</script>

<template>
    <section class="page page-product">
        <a href="/">← Back</a>
        <h1>{{ page.product.name }}</h1>
        <p class="price price-large">${{ page.product.price.toFixed(2) }}</p>
        <p>{{ page.product.description }}</p>
    </section>
</template>
