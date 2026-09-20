<script setup lang="ts">
import ProductCard from "../components/ProductCard.vue";
import type { SearchPage } from "../lib/models/product";

const { page } = defineProps<{ page: SearchPage }>();
</script>

<template>
    <section class="page page-search">
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>

        <div class="results">
            <ProductCard v-for="item in page.results" :key="item.id" :item="item" />
        </div>

        <p v-if="page.results.length === 0">No products found.</p>
    </section>
</template>
