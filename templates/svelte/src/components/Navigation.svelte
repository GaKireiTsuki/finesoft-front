<script lang="ts">
	let { currentPath = "/" }: { currentPath?: string } = $props();
	const links = [{ label: "Home", href: "/" }, { label: "Search", href: "/search" }, { label: "About", href: "/about" }, { label: "GitHub", href: "https://github.com/nicepkg/finesoft" }];
</script>

<nav class="navigation">
	{#each links as link}
		<a
			href={link.href}
			class="navigation-link"
			class:active={currentPath === link.href}>{link.label}</a
		>
	{/each}
</nav>
