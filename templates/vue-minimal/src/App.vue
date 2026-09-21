<script setup lang="ts">
import { Outlet as selectOutlet, useSnapshot, type WebAppView } from "@finesoft/front";
import { onMounted, onUnmounted, ref } from "vue";
import { TAB_LABELS } from "./lib/navigation";
import { views } from "./views";
const Outlet = selectOutlet("vue");

defineOptions({ inheritAttrs: false });
const { app } = defineProps<{ app: WebAppView }>();
const snapshot = useSnapshot("vue", app);
// Start empty on both server and client; restore the profile after hydration.
const name = ref("");
let unregister: (() => void) | undefined;
onUnmounted(() => unregister?.());
onMounted(() => {
    unregister = app.session?.register({
        key: "profile",
        version: 1,
        decode: (data) => {
            if (
                !data ||
                typeof data !== "object" ||
                typeof (data as { name?: unknown }).name !== "string"
            )
                throw Error("invalid-profile-state");
            return data as { name: string };
        },
        capture: () => ({ name: name.value }),
        restore: (data) => {
            name.value = data.name;
        },
    });
});
</script>

<template>
    <div class="app-chrome">
        <header class="profile">
            <label>
                Your name (global):
                <input
                    :value="name"
                    placeholder="anon"
                    @input="name = ($event.target as HTMLInputElement).value"
                    @blur="app.session?.save()"
                />
            </label>
            <span v-if="name">👋 {{ name }}</span>
        </header>
        <nav v-if="snapshot.navigation.tabs" class="tabs" aria-label="Pages">
            <button
                v-for="key in snapshot.navigation.tabs.order"
                :key="key"
                :aria-current="key === snapshot.navigation.tabs.active"
                @click="app.perform({ kind: 'selectTab', key })"
            >
                {{ TAB_LABELS[key] ?? key }}
            </button>
        </nav>
        <button v-if="snapshot.navigation.canGoBack" @click="app.perform({ kind: 'pop' })">
            ← Back
        </button>
        <Outlet :app="app" :views="views" />
    </div>
</template>
