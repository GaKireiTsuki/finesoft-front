<script setup lang="ts">
import { computed, ref } from "vue";
import type { Action } from "@finesoft/front";
import { KeepAliveOutlet, onActivate, onDeactivate } from "@finesoft/front/vue";
import type { AboutPage } from "../lib/models/product";

const { page, onAction: _onAction } = defineProps<{
    page: AboutPage;
    onAction?: (action: Action) => void;
}>();

const activationCount = ref(0);
const deactivationCount = ref(0);
const draft = ref("");
const activeTab = ref<"overview" | "notes">("overview");

onActivate(() => {
    activationCount.value += 1;
});

onDeactivate(() => {
    deactivationCount.value += 1;
});

const OverviewTab = {
    name: "OverviewTab",
    setup() {
        const text = ref("");
        const count = ref(0);

        onActivate(() => {
            count.value += 1;
        });

        return { text, count };
    },
    template: `
        <div style="display: grid; gap: 0.5rem">
            <p>Overview activations: {{ count }}</p>
            <label style="display: grid; gap: 0.5rem; max-width: 24rem">
                Overview note
                <input v-model="text" />
            </label>
        </div>
    `,
};

const NotesTab = {
    name: "NotesTab",
    setup() {
        const count = ref(0);
        const activationCount = ref(0);

        onActivate(() => {
            activationCount.value += 1;
        });

        return { count, activationCount };
    },
    template: `
        <div style="display: grid; gap: 0.5rem">
            <p>Notes activations: {{ activationCount }}</p>
            <p>Counter: {{ count }}</p>
            <button type="button" @click="count += 1">Increment</button>
        </div>
    `,
};

const activeComponent = computed(() => (activeTab.value === "overview" ? OverviewTab : NotesTab));
const outletProps = {};
</script>

<template>
    <div style="display: grid; gap: 1rem">
        <h1>{{ page.title }}</h1>
        <p>{{ page.content }}</p>

        <section style="border: 1px solid #eee; border-radius: 0.75rem; padding: 1rem">
            <h2>Page keep alive</h2>
            <p>Activate: {{ activationCount }}</p>
            <p>Deactivate: {{ deactivationCount }}</p>
            <label style="display: grid; gap: 0.5rem; max-width: 24rem">
                Draft message
                <input v-model="draft" />
            </label>
        </section>

        <section style="border: 1px solid #eee; border-radius: 0.75rem; padding: 1rem">
            <h2>KeepAlive outlet</h2>
            <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem">
                <button type="button" @click="activeTab = 'overview'">Overview tab</button>
                <button type="button" @click="activeTab = 'notes'">Notes tab</button>
            </div>
            <KeepAliveOutlet
                :cache-key="activeTab"
                :component="activeComponent"
                :component-props="outletProps"
            />
        </section>
    </div>
</template>
