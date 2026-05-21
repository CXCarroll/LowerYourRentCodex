<script lang="ts">
	// Six single-digit boxes for the email verification code. Auto-advances on
	// entry, handles backspace/arrows, supports paste, and calls `onComplete`
	// the instant the sixth digit lands. Styled to match GlassInput.svelte.

	import { untrack } from 'svelte';

	interface Props {
		onComplete: (code: string) => void;
		disabled?: boolean;
		error?: boolean;
		/** Bump this (from the parent) to clear all boxes and refocus box 0 —
		 *  used after a bad code or a resend. */
		resetKey?: number;
	}

	let { onComplete, disabled = false, error = false, resetKey = 0 }: Props = $props();

	const LEN = 6;
	let digits = $state<string[]>(Array(LEN).fill(''));
	let inputs = $state<(HTMLInputElement | null)[]>(Array(LEN).fill(null));
	let focused = $state(-1);

	function focusBox(i: number) {
		const el = inputs[Math.max(0, Math.min(LEN - 1, i))];
		el?.focus();
		el?.select();
	}

	function maybeComplete() {
		if (digits.every((d) => d !== '')) onComplete(digits.join(''));
	}

	function onInput(i: number, e: Event) {
		const target = e.target as HTMLInputElement;
		const digit = target.value.replace(/\D/g, '').slice(-1);
		digits[i] = digit;
		target.value = digit; // strip any non-digit / overflow the browser kept
		if (digit && i < LEN - 1) focusBox(i + 1);
		if (digit) maybeComplete();
	}

	function onKeydown(i: number, e: KeyboardEvent) {
		if (e.key === 'Backspace' && digits[i] === '' && i > 0) {
			e.preventDefault();
			digits[i - 1] = '';
			focusBox(i - 1);
		} else if (e.key === 'ArrowLeft' && i > 0) {
			e.preventDefault();
			focusBox(i - 1);
		} else if (e.key === 'ArrowRight' && i < LEN - 1) {
			e.preventDefault();
			focusBox(i + 1);
		}
	}

	function onPaste(e: ClipboardEvent) {
		e.preventDefault();
		const pasted = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, LEN);
		if (!pasted) return;
		const next = Array(LEN).fill('');
		for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
		digits = next;
		focusBox(Math.min(pasted.length, LEN - 1));
		maybeComplete();
	}

	// Runs on mount and whenever the parent bumps resetKey (bad code / resend):
	// clear every box and refocus the first.
	$effect(() => {
		resetKey;
		untrack(() => {
			digits = Array(LEN).fill('');
			focusBox(0);
		});
	});
</script>

<div class="flex" style="gap: 8px;">
	{#each digits as digit, i (i)}
		<input
			bind:this={inputs[i]}
			value={digit}
			{disabled}
			type="text"
			inputmode="numeric"
			maxlength="1"
			autocomplete={i === 0 ? 'one-time-code' : 'off'}
			aria-label={`Digit ${i + 1}`}
			aria-invalid={error ? 'true' : undefined}
			oninput={(e) => onInput(i, e)}
			onkeydown={(e) => onKeydown(i, e)}
			onpaste={onPaste}
			onfocus={() => (focused = i)}
			onblur={() => (focused = -1)}
			class="lyr-otp-input min-w-0 text-center"
			style="
				flex: 1;
				height: 56px;
				border-radius: 14px;
				background: rgba(255,255,255,{focused === i ? 0.85 : 0.55});
				border: 0.5px solid {error
				? 'rgba(192,57,43,0.55)'
				: focused === i
					? 'var(--hairline-strong)'
					: 'var(--hairline)'};
				box-shadow: {error
				? 'inset 0 1px 0 rgba(255,255,255,0.9), 0 0 0 4px rgba(192,57,43,0.08)'
				: focused === i
					? 'inset 0 1px 0 rgba(255,255,255,0.9), 0 0 0 4px rgba(30,30,40,0.06)'
					: 'inset 0 1px 0 rgba(255,255,255,0.9)'};
				font-family: var(--font-sans);
				font-size: 22px;
				font-weight: 600;
				color: var(--ink);
				transition: all 180ms ease;
				opacity: {disabled ? 0.55 : 1};
			"
		/>
	{/each}
</div>
