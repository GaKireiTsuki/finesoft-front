<script setup lang="ts">
import type { Action } from "@finesoft/front/web";
import { NAV_ACTIONS } from "../actions";
import type { ProductPage } from "../lib/models/product";

const { page, onAction } = defineProps<{
    page: ProductPage;
    onAction?: (action: Action) => void;
}>();

function handleBack(e: MouseEvent) {
    if (
        !onAction ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
    )
        return;
    e.preventDefault();
    onAction(NAV_ACTIONS.home);
}
</script>

<template>
    <section class="page page-product">
        <a href="/" @click="handleBack">← Back</a>
        <h1>{{ page.product.name }}</h1>
        <p class="price price-large">${{ page.product.price.toFixed(2) }}</p>
        <p>{{ page.product.description }}</p>
    </section>
</template>
