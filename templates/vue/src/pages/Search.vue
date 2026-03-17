<script setup lang="ts">
import type { Action } from "@finesoft/front";
import ProductCard from "../components/ProductCard.vue";
import type { SearchPage } from "../lib/models/product";

const { page, onAction } = defineProps<{ page: SearchPage; onAction?: (action: Action) => void }>();
</script>

<template>
    <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>

        <div class="results">
            <ProductCard
                v-for="item in page.results"
                :key="item.id"
                :item="item"
                :on-action="onAction"
            />
        </div>

        <p v-if="page.results.length === 0">No products found.</p>
    </div>
</template>

<style scoped>
.results {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
}
</style>
