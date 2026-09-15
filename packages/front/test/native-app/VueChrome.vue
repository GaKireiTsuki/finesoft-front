<script setup lang="ts">
import type { NavigationSnapshot } from "@finesoft/front/web";
type ViewProps = { initialSnapshot: NavigationSnapshot };
defineProps<ViewProps>();
</script>
<template>
    <output data-chrome>{{ initialSnapshot.destinations.at(-1)?.page.title ?? "empty" }}</output>
</template>
