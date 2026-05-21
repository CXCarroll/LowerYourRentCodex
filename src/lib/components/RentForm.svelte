<script lang="ts">
	// Demo-mode SPA form, ported from the Claude-Design prototype's FormScreen.
	// Drives the entire home flow: collapsing fields, email verification, the
	// particle invisible-ink textarea, typewriter reveal.
	//
	// On submit it POSTs /api/verify/send to email a 6-digit code; the user
	// enters the code into <OtpInput>, which POSTs /api/verify/check. A valid
	// code returns up to 3 data-backed email variations. An invisible
	// Cloudflare Turnstile check guards /verify/send when configured (no-op in
	// dev).

	import GlassInput from '$lib/components/GlassInput.svelte';
	import AddressAutocomplete from '$lib/components/AddressAutocomplete.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import PrimaryButton from '$lib/components/PrimaryButton.svelte';
	import CollapsibleField from '$lib/components/CollapsibleField.svelte';
	import InvisibleInk from '$lib/components/InvisibleInk.svelte';
	import OtpInput from '$lib/components/OtpInput.svelte';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import { PUBLIC_TURNSTILE_SITE_KEY } from '$env/static/public';
	import { emailSchema, rentInputToCents, submissionSchema } from '$lib/shared/validation';
	import type { AptType } from '$lib/shared/apt-types';
	import { formatDollars, type NegotiationVersion } from '$lib/shared/email-template';

	const SEG_OPTIONS: Array<{ value: AptType; label: string }> = [
		{ value: 'studio', label: 'Studio' },
		{ value: '1br', label: '1 BR' },
		{ value: '2br', label: '2 BR' },
		{ value: '3br', label: '3+ BR' }
	];
	const ADDRESS_ID = 'lyr-address';
	const ADDRESS_ERROR_ID = 'lyr-address-error';
	const APARTMENT_ID = 'lyr-apartment';
	const RENT_ID = 'lyr-rent';
	const LEASE_ID = 'lyr-lease';
	const EMAIL_ID = 'lyr-email';
	const EMAIL_ERROR_ID = 'lyr-email-error';

	// ─── Form state ───────────────────────────────────────────────────────────
	let address = $state('');
	// Inline error for the Address field — set when submit-time verification
	// rejects the address (422); cleared as soon as the user edits it.
	let addressError = $state('');
	// Unit / apartment number. Held only so the user has somewhere obvious to
	// put it (Mapbox autocomplete won't); deliberately never POSTed or stored —
	// area-rent figures are ZIP/county/metro-scoped and don't need the unit.
	let apartment = $state('');
	let aptType = $state<AptType>('1br');
	let rent = $state('');
	let lease = $state('');
	let notes = $state('');
	// Email — required. A 6-digit verification code is mailed here on submit.
	let email = $state('');
	let emailError = $state('');
	let formError = $state('');

	// ─── Collapse state ───────────────────────────────────────────────────────
	let collapsed = $state({
		address: false,
		apartment: false,
		aptType: false,
		rent: false,
		lease: false
	});
	// Apartment shares a row with Address, so collapsing it reclaims no extra
	// vertical space — it's excluded from the count that drives ink height + gap.
	const collapsedCount = $derived(
		[collapsed.address, collapsed.aptType, collapsed.rent, collapsed.lease].filter(Boolean)
			.length
	);

	function collapse(key: keyof typeof collapsed) {
		if (!collapsed[key]) collapsed = { ...collapsed, [key]: true };
	}
	function expand(key: keyof typeof collapsed) {
		collapsed = { ...collapsed, [key]: false };
		// Refocus the input after the expand transition (~160ms slot fade + buffer).
		setTimeout(() => {
			document.getElementById(`lyr-${key}`)?.focus();
		}, 220);
	}

	// ─── Field validity ──────────────────────────────────────────────────────
	const addressValid = $derived(address.trim().length > 8);
	const rentValid = $derived(rent.length > 0);
	const leaseValid = $derived(lease.length > 0);

	// ─── Display strings for collapsed summaries ────────────────────────────
	const aptLabel = $derived(SEG_OPTIONS.find((o) => o.value === aptType)?.label ?? '');
	const leaseDisplay = $derived(
		lease
			? new Date(lease + 'T00:00:00').toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric',
					year: 'numeric'
				})
			: ''
	);
	const rentDisplay = $derived(rent ? `$${rent}/mo` : '');

	// ─── Submit + verification flow ──────────────────────────────────────────
	// 'form'         → editing fields; "Lower My Rent" emails a code
	// 'awaitingCode' → code sent, OTP boxes shown
	// 'verifying'    → checking the entered code
	type Phase = 'form' | 'awaitingCode' | 'verifying';
	let phase = $state<Phase>('form');
	let sending = $state(false);
	let verified = $state(false);

	// The address a code was actually emailed to — drives the OTP heading and
	// the /verify/check call, independent of later edits to the email field.
	let sentToEmail = $state('');
	let codeError = $state('');
	// Bumped to tell <OtpInput> to clear its boxes (after a bad code / resend).
	let otpResetKey = $state(0);

	const showOtp = $derived(
		(phase === 'awaitingCode' || phase === 'verifying') && !verified
	);

	// ─── Cloudflare Turnstile (invisible bot check) ──────────────────────────
	// Inert when PUBLIC_TURNSTILE_SITE_KEY is unset (local dev): the component
	// renders nothing and `turnstileToken` stays null, which the server treats
	// as "check disabled" so the flow works unchanged.
	const turnstileEnabled = !!PUBLIC_TURNSTILE_SITE_KEY;
	let turnstileToken = $state<string | null>(null);
	// Turnstile tokens are single-use. Bumping this key remounts the widget so
	// a resend / second submit gets a fresh, unconsumed token.
	let turnstileNonce = $state(0);
	let turnstileConsumed = false;

	// ─── Post-submit merge ───────────────────────────────────────────────────
	// On submit, all collapsed-summary rows merge into a single "Edit info"
	// button so the email field gets more vertical space. Tapping the button
	// (see editInfo) resets the flow to the editable 'form' phase so a changed
	// rent/address regenerates the negotiation email; the button reappears
	// after the next successful verify.
	let infoMerged = $state(false);

	// ─── Email actions (Copy + Version picker) ───────────────────────────────
	// After submit the server returns up to 3 email variations with real
	// market data already substituted. Each version asks for a different rent
	// reduction; the picker labels its pills with that amount and swaps the
	// pre-rendered `versions` with a 150 ms fade — no rebuild, no extra request.
	let versions = $state<NegotiationVersion[]>([]);
	let activeIndex = $state(0);
	const showPicker = $derived(versions.length >= 2);
	const versionOptions = $derived(
		versions.map((v, i) => ({
			value: String(i),
			label: `−${formatDollars(v.reductionCents)}/mo`
		}))
	);

	let copied = $state(false);
	let swapping = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let swapTimer: ReturnType<typeof setTimeout> | null = null;

	// Used only if POST /api/verify/check fails at the transport layer
	// (e.g. offline). Every server-side failure mode is already handled by the
	// endpoint, which always responds with a usable body.
	const FALLBACK_BODY = `Hi [Landlord name],

I hope you're doing well. My lease is up for renewal soon, and I'd like to open a conversation about the renewal rate before deciding on my next steps.

I've been a reliable tenant — always paid on time — and I'd prefer to renew rather than move. Could we find a renewal rate that works for both of us? I'd welcome a quick call to talk it through.

Thanks for considering.

— [Your name]`;

	$effect(() => {
		return () => {
			if (copyTimer) clearTimeout(copyTimer);
			if (swapTimer) clearTimeout(swapTimer);
		};
	});

	async function onCopy() {
		try {
			await navigator.clipboard.writeText(notes);
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard API requires a secure context. Localhost dev + prod
			// HTTPS both qualify; silently ignore the rare failure case.
		}
	}

	function onPickVersion(v: string) {
		const i = Number(v);
		if (!Number.isInteger(i) || i === activeIndex || i < 0 || i >= versions.length) return;

		// Cancel any in-progress typewriter so the swap is clean. The initial
		// reveal after submit runs a ~6.4 s setInterval; tapping a version
		// before it finishes jumps straight to the new full body.
		if (typingTimer) {
			clearInterval(typingTimer);
			typingTimer = null;
		}

		activeIndex = i; // pill slides immediately
		swapping = true; // wrapper fades out
		if (swapTimer) clearTimeout(swapTimer);
		swapTimer = setTimeout(() => {
			notes = versions[i].body;
			swapping = false; // wrapper fades back in
		}, 150);
	}

	let typingTimer: ReturnType<typeof setInterval> | null = null;
	$effect(() => {
		return () => {
			if (typingTimer) clearInterval(typingTimer);
		};
	});

	// "Edit info" — drop the verified state and the generated email, returning
	// to the editable 'form' phase. A changed rent/address must go back through
	// /verify/send → code → /verify/check, which regenerates the negotiation
	// email server-side; the old email can't be silently rebuilt because the
	// verification code is single-use.
	function editInfo() {
		// Stop the verified-state animations so they don't write a stale body
		// back into `notes` after the reset.
		if (typingTimer) {
			clearInterval(typingTimer);
			typingTimer = null;
		}
		if (swapTimer) {
			clearTimeout(swapTimer);
			swapTimer = null;
		}
		if (copyTimer) {
			clearTimeout(copyTimer);
			copyTimer = null;
		}

		infoMerged = false;
		phase = 'form';
		verified = false;
		versions = [];
		activeIndex = 0;
		notes = '';
		swapping = false;
		copied = false;
		codeError = '';
		addressError = '';
		formError = '';
		otpResetKey += 1;
	}

	// A Turnstile token is single-use; once spent, remount the widget so the
	// next /verify/send call gets a fresh, unconsumed token.
	function ensureFreshTurnstile() {
		if (turnstileEnabled && turnstileConsumed) {
			turnstileToken = null;
			turnstileNonce += 1;
			turnstileConsumed = false;
		}
	}

	// The invisible Turnstile widget produces its token in the background. If
	// it hasn't landed yet, wait briefly; if it never arrives, proceed with a
	// null token and let the server decide (it falls back gracefully).
	async function waitForTurnstile() {
		if (!turnstileEnabled || turnstileToken) return;
		const start = Date.now();
		while (!turnstileToken && Date.now() - start < 4000) {
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	function sendErrorMessage(status: number): string {
		if (status === 429) return 'Too many requests — wait a minute and try again.';
		if (status === 403) return "Couldn't verify you're human — refresh and try again.";
		if (status === 502) return "We couldn't send that email — double-check the address.";
		if (status === 503) return 'Service is temporarily unavailable — try again shortly.';
		return 'Enter a valid email address.';
	}

	function currentSubmissionPayload() {
		return {
			address,
			aptType,
			rentCents: rentInputToCents(rent) ?? undefined,
			leaseExpiry: lease
		};
	}

	function focusInvalidSubmissionField(path: string) {
		if (path === 'address') expand('address');
		else if (path === 'rentCents') expand('rent');
		else if (path === 'leaseExpiry') expand('lease');
		else if (path === 'aptType') collapsed = { ...collapsed, aptType: false };
	}

	function validateSubmissionForClient() {
		const parsed = submissionSchema.safeParse(currentSubmissionPayload());
		if (parsed.success) {
			formError = '';
			return true;
		}

		const first = parsed.error.issues[0];
		formError = first?.message ?? 'Check your rent details and try again.';
		focusInvalidSubmissionField(first?.path.join('.') ?? '');
		return false;
	}

	// Step 1: validate the email and ask the server to mail a 6-digit code.
	async function sendCode(isResend: boolean) {
		if (sending) return;
		if (!isResend && !validateSubmissionForClient()) return;

		const parsed = emailSchema.safeParse(email);
		if (!parsed.success) {
			const msg = parsed.error.issues[0]?.message ?? 'Enter a valid email address.';
			if (isResend) codeError = msg;
			else emailError = msg;
			return;
		}
		emailError = '';
		codeError = '';
		sending = true;

		ensureFreshTurnstile();
		await waitForTurnstile();

		try {
			const res = await fetch('/api/verify/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: parsed.data, turnstileToken })
			});
			turnstileConsumed = true;
			if (!res.ok) {
				const msg = sendErrorMessage(res.status);
				if (isResend) codeError = msg;
				else emailError = msg;
				return;
			}
			sentToEmail = parsed.data;
			phase = 'awaitingCode';
			if (isResend) otpResetKey += 1;
		} catch {
			const msg = 'Network error — check your connection and try again.';
			if (isResend) codeError = msg;
			else emailError = msg;
		} finally {
			sending = false;
		}
	}

	function onSubmit(e?: Event) {
		e?.preventDefault();
		if (phase !== 'form') return;
		addressError = '';
		formError = '';
		if (!validateSubmissionForClient()) return;
		void sendCode(false);
	}

	function useDifferentEmail() {
		phase = 'form';
		codeError = '';
		otpResetKey += 1;
	}

	// Step 2: submit the 6-digit code. On success the negotiation emails are
	// generated and revealed; the OtpInput auto-calls this on the 6th digit.
	async function onVerify(code: string) {
		if (phase === 'verifying') return;
		phase = 'verifying';
		codeError = '';

		let fetched: NegotiationVersion[] | null = null;
		try {
			const res = await fetch('/api/verify/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: sentToEmail,
					code,
					...currentSubmissionPayload()
				})
			});
			const data = await res.json().catch(() => ({}));

			// Address verification failed server-side — send the user back to the
			// form to fix it. The code is untouched (checked before the code).
			if (res.status === 422 && data?.error === 'address_not_found') {
				phase = 'form';
				addressError = "We couldn't find that address — double-check it and try again.";
				expand('address');
				return;
			}

			if (
				res.status === 422 &&
				(data?.error === 'invalid_submission' ||
					data?.error === 'missing_zip' ||
					data?.error === 'unsupported_zip')
			) {
				phase = 'form';
				const issue = Array.isArray(data?.issues) ? data.issues[0] : null;
				formError =
					typeof issue?.message === 'string'
						? issue.message
						: data?.error === 'unsupported_zip'
							? "We don't have market data for that ZIP yet."
							: "We couldn't resolve that address — include city, state, and ZIP.";
				if (typeof issue?.path === 'string') focusInvalidSubmissionField(issue.path);
				else expand('address');
				return;
			}

			if (!res.ok) {
				phase = 'awaitingCode';
				otpResetKey += 1;
				if (res.status === 401) codeError = "That code isn't right — try again.";
				else if (res.status === 410) codeError = 'That code expired — request a new one.';
				else if (res.status === 429) codeError = 'Too many tries — request a new code.';
				else codeError = 'Something went wrong — try that code again.';
				return;
			}

			fetched =
				Array.isArray(data?.versions) && data.versions.length > 0
					? (data.versions as NegotiationVersion[])
					: [{ body: FALLBACK_BODY, reductionCents: 0 }];
		} catch {
			fetched = [{ body: FALLBACK_BODY, reductionCents: 0 }];
		}

		if (!fetched) return;

		verified = true;
		infoMerged = true;
		versions = fetched;
		activeIndex = 0;
		notes = '';

		// Typewriter reveal of the first variation.
		const body = versions[0].body;
		const TOTAL_MS = 6400;
		const TICK = 18;
		const ticks = Math.max(1, Math.floor(TOTAL_MS / TICK));
		const perTick = Math.max(1, Math.ceil(body.length / ticks));
		let i = 0;
		setTimeout(() => {
			if (typingTimer) clearInterval(typingTimer);
			typingTimer = setInterval(() => {
				i = Math.min(body.length, i + perTick);
				notes = body.slice(0, i);
				if (i >= body.length) {
					if (typingTimer) clearInterval(typingTimer);
					typingTimer = null;
				}
			}, TICK);
		}, 500);
	}

	// ─── Invisible-ink height — grows as fields collapse + flow advances ─────
	// The infoMerged bonus is smaller than it would be without an actions row
	// because Copy + Version-picker row eats back ~60 px of the reclaimed space.
	const inkHeight = $derived(
		220 +
			collapsedCount * 52 +
			(verified ? 150 : 0) +
			(infoMerged ? 60 : 0)
	);

	const fieldGap = $derived(Math.max(2, 18 - collapsedCount * 2.8));
</script>

<form
	class="glass-card flex flex-col"
	style="padding: 22px;"
	onsubmit={onSubmit}
	novalidate
>
	<!-- Spacing between rows lives on each row's margin-bottom so a row that
	     collapses to 0fr can also collapse its trailing gap. A uniform flex
	     `gap` would leave dead air above the email field after submit. -->

	<!-- Collapsible field stack — gap tightens as fields collapse. Wrapped in
	     a grid-rows tween so the whole stack collapses to 0fr after submit;
	     an "Edit info" button replaces it (see sibling block below). -->
	<div
		class="grid"
		style="
			grid-template-rows: {infoMerged ? '0fr' : '1fr'};
			margin-bottom: {infoMerged ? '0px' : '18px'};
			transition:
				grid-template-rows 420ms cubic-bezier(0.32,0.72,0,1),
				margin-bottom 420ms cubic-bezier(0.32,0.72,0,1);
		"
	>
	<div
		class="overflow-hidden"
		style="
			opacity: {infoMerged ? 0 : 1};
			transition: opacity 240ms ease;
			transition-delay: {infoMerged ? '0ms' : '180ms'};
		"
	>
	<div
		class="flex flex-col"
		style="
			gap: {fieldGap}px;
			transition: gap 320ms cubic-bezier(0.32,0.72,0,1);
		"
	>
		<!-- Address + Apartment side-by-side, 75 / 25. -->
		<div class="grid" style="grid-template-columns: minmax(0,3fr) minmax(0,1fr); gap: 12px;">
			<CollapsibleField
				label="Address"
				inputId={ADDRESS_ID}
				collapsed={collapsed.address}
				summary={address}
				onEdit={() => expand('address')}
				error={addressError}
				errorId={ADDRESS_ERROR_ID}
			>
				<div
					onfocusout={() => {
						if (addressValid) collapse('address');
					}}
					role="presentation"
				>
					<AddressAutocomplete
						id={ADDRESS_ID}
						name="address"
						placeholder="123 Main St, Brooklyn NY"
						value={address}
						ariaInvalid={!!addressError}
						ariaDescribedby={addressError ? ADDRESS_ERROR_ID : undefined}
						ariaErrormessage={addressError ? ADDRESS_ERROR_ID : undefined}
						onValue={(v) => {
							address = v;
							addressError = '';
							formError = '';
						}}
					/>
				</div>
			</CollapsibleField>

			<!-- Apartment — collapsible like the other fields. The 25% column is
			     too narrow for the standard label + value + icon summary row, so
			     the collapsed state shows just the value (or "Apt" when empty)
			     and the edit button. -->
			<div class="relative">
				<!-- Collapsed summary -->
				<div
					class="grid"
					style="
						grid-template-rows: {collapsed.apartment ? '1fr' : '0fr'};
						transition: grid-template-rows 340ms cubic-bezier(0.32,0.72,0,1);
					"
				>
					<div
						class="overflow-hidden"
						style="
							opacity: {collapsed.apartment ? 1 : 0};
							transition: opacity 200ms ease;
							transition-delay: {collapsed.apartment ? '160ms' : '0ms'};
						"
					>
						<button
							type="button"
							onclick={() => expand('apartment')}
							aria-label={apartment ? `Edit Apartment: ${apartment}` : 'Edit Apartment'}
							class="w-full flex items-center justify-end bg-transparent border-0 cursor-pointer"
							style="padding: 2px 4px; gap: 8px;"
						>
							<span
								class="min-w-0 truncate"
								style="
									font-family: var(--font-sans);
									font-size: 15px;
									font-weight: 500;
									color: #1e1e28;
									letter-spacing: -0.1px;
								"
							>
								{apartment || 'Apt'}
							</span>
							<svg
								width="11"
								height="11"
								viewBox="0 0 12 12"
								class="flex-shrink-0"
								style="color: rgba(30,30,40,0.4);"
							>
								<path
									d="M2 10l5-5 2 2-5 5H2v-2zM7 5l2 2"
									stroke="currentColor"
									stroke-width="1.3"
									fill="none"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					</div>
				</div>

				<!-- Expanded input -->
				<div
					class="grid"
					style="
						grid-template-rows: {collapsed.apartment ? '0fr' : '1fr'};
						transition: grid-template-rows 340ms cubic-bezier(0.32,0.72,0,1);
					"
				>
					<div
						class="overflow-hidden"
						style="
							opacity: {collapsed.apartment ? 0 : 1};
							transition: opacity 200ms ease;
							transition-delay: {collapsed.apartment ? '0ms' : '160ms'};
						"
					>
						<div
							class="flex flex-col min-w-0"
							style="gap: 6px;"
							onfocusout={() => collapse('apartment')}
							role="presentation"
						>
							<label
								for={APARTMENT_ID}
								style="
									font-family: var(--font-sans);
									font-size: 11px;
									font-weight: 600;
									letter-spacing: 0.8px;
									text-transform: uppercase;
									color: rgba(30,30,40,0.55);
								"
							>
								Apartment
							</label>
							<GlassInput
								id={APARTMENT_ID}
								name="apartment"
								autocomplete="address-line2"
								placeholder="4B"
								value={apartment}
								onValue={(v) => (apartment = v)}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>

		<CollapsibleField
			label="Apartment type"
			collapsed={collapsed.aptType}
			summary={aptLabel}
			onEdit={() => (collapsed = { ...collapsed, aptType: false })}
		>
			<Segmented
				options={SEG_OPTIONS}
				value={aptType}
				onSelect={(v) => {
					aptType = v;
					formError = '';
					setTimeout(() => collapse('aptType'), 340);
				}}
			/>
		</CollapsibleField>

		<!-- Rent + Lease side-by-side from the start. -->
		<div class="grid" style="grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px;">
			<CollapsibleField
				label="Current rent"
				inputId={RENT_ID}
				collapsed={collapsed.rent}
				summary={rentDisplay}
				onEdit={() => expand('rent')}
			>
				<div
					onfocusout={() => {
						if (rentValid) collapse('rent');
					}}
					role="presentation"
				>
					<GlassInput
						id={RENT_ID}
						name="rent"
						inputmode="decimal"
						placeholder="2,500"
						prefix="$"
						value={rent}
						onValue={(v) => {
							rent = v.replace(/[^\d,]/g, '');
							formError = '';
						}}
					/>
				</div>
			</CollapsibleField>

			<CollapsibleField
				label="Lease ends"
				inputId={LEASE_ID}
				collapsed={collapsed.lease}
				summary={leaseDisplay}
				onEdit={() => expand('lease')}
			>
				<div
					onfocusout={() => {
						if (leaseValid) collapse('lease');
					}}
					role="presentation"
				>
					<GlassInput
						id={LEASE_ID}
						name="lease"
						type="date"
						value={lease}
						onValue={(v) => {
							lease = v;
							formError = '';
							if (v) setTimeout(() => collapse('lease'), 180);
						}}
					/>
				</div>
			</CollapsibleField>
		</div>

		<!-- Email — required. A 6-digit verification code is mailed here on
		     submit. Plain labelled input (not collapsible): it stays visible
		     and editable through the code-entry step. -->
		<div class="flex flex-col min-w-0" style="gap: 6px;">
			<label
				for={EMAIL_ID}
				style="
					font-family: var(--font-sans);
					font-size: 11px;
					font-weight: 600;
					letter-spacing: 0.8px;
					text-transform: uppercase;
					color: rgba(30,30,40,0.55);
				"
			>
				Email
			</label>
			<GlassInput
				id={EMAIL_ID}
				name="email"
				type="email"
				inputmode="email"
				autocomplete="email"
				placeholder="you@example.com"
				value={email}
				ariaInvalid={!!emailError}
				ariaDescribedby={emailError ? EMAIL_ERROR_ID : undefined}
				ariaErrormessage={emailError ? EMAIL_ERROR_ID : undefined}
				onValue={(v) => {
					email = v;
					emailError = '';
				}}
			/>
			{#if emailError}
				<span
					id={EMAIL_ERROR_ID}
					style="font-family: var(--font-sans); font-size: 12px; color: rgba(192,57,43,0.92); padding-left: 2px;"
				>
					{emailError}
				</span>
			{/if}
		</div>
		</div>
	</div>
	</div>

	<!-- Edit info button — replaces the field stack once the user submits.
	     Tap to bring the editable summary rows back and reset the flow to the
	     'form' phase (see editInfo): changing rent/address requires re-verifying
	     so the negotiation email is regenerated. The button reappears after the
	     next successful verify. -->
	<div
		class="grid"
		style="
			grid-template-rows: {infoMerged ? '1fr' : '0fr'};
			margin-bottom: {infoMerged ? '18px' : '0px'};
			transition:
				grid-template-rows 420ms cubic-bezier(0.32,0.72,0,1),
				margin-bottom 420ms cubic-bezier(0.32,0.72,0,1);
		"
	>
		<div
			class="overflow-hidden"
			style="
				opacity: {infoMerged ? 1 : 0};
				transition: opacity 240ms ease;
				transition-delay: {infoMerged ? '180ms' : '0ms'};
			"
		>
			<div class="flex flex-col" style="gap: 10px;">
				<button
					type="button"
					onclick={editInfo}
					class="w-full flex items-center justify-center cursor-pointer"
					style="
						gap: 8px;
						padding: 9px 12px;
						background: rgba(255,255,255,0.55);
						border: 0.5px solid rgba(30,30,40,0.12);
						border-radius: 12px;
						font-family: var(--font-sans);
						font-size: 12px;
						font-weight: 600;
						letter-spacing: 0.6px;
						text-transform: uppercase;
						color: rgba(30,30,40,0.7);
					"
				>
					<svg width="11" height="11" viewBox="0 0 12 12">
						<path
							d="M2 10l5-5 2 2-5 5H2v-2zM7 5l2 2"
							stroke="currentColor"
							stroke-width="1.3"
							fill="none"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span>Edit info</span>
				</button>

				<!-- Actions row: Copy on the left, Version segmented control on the right. -->
				<div class="flex items-stretch" style="gap: 10px;">
					<button
						type="button"
						onclick={onCopy}
						class="flex-shrink-0 flex items-center justify-center cursor-pointer"
						style="
							gap: 6px;
							padding: 0 14px;
							min-height: 44px;
							background: rgba(255,255,255,0.55);
							border: 0.5px solid rgba(30,30,40,0.12);
							border-radius: 14px;
							font-family: var(--font-sans);
							font-size: 12px;
							font-weight: 600;
							letter-spacing: 0.6px;
							text-transform: uppercase;
							color: {copied ? 'var(--accent-deep)' : 'rgba(30,30,40,0.7)'};
							transition: color 180ms;
						"
					>
						{#if copied}
							<svg width="11" height="11" viewBox="0 0 12 12">
								<path
									d="M1.5 6l3 3 6-6"
									stroke="currentColor"
									stroke-width="1.6"
									fill="none"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
							<span>Copied</span>
						{:else}
							<svg width="11" height="11" viewBox="0 0 12 12">
								<rect
									x="3"
									y="3"
									width="7"
									height="8"
									rx="1.3"
									stroke="currentColor"
									stroke-width="1.2"
									fill="none"
								/>
								<path
									d="M2 8.5V2.3A1 1 0 0 1 3 1.3h5"
									stroke="currentColor"
									stroke-width="1.2"
									fill="none"
									stroke-linecap="round"
								/>
							</svg>
							<span>Copy</span>
						{/if}
					</button>

					{#if showPicker}
						<div class="flex-1 min-w-0">
							<Segmented
								options={versionOptions}
								value={String(activeIndex)}
								onSelect={onPickVersion}
							/>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Submit row — animated grid-rows + margin out once the flow leaves the
	     'form' step (code sent / verifying / verified). -->
	<div
		class="grid"
		style="
			grid-template-rows: {phase !== 'form' ? '0fr' : '1fr'};
			margin-bottom: {phase !== 'form' ? '0px' : '18px'};
			transition:
				grid-template-rows 380ms cubic-bezier(0.32,0.72,0,1),
				margin-bottom 380ms cubic-bezier(0.32,0.72,0,1);
		"
	>
		<div
			class="overflow-hidden"
			style="
				opacity: {phase !== 'form' ? 0 : 1};
				transition: opacity 220ms ease;
				transition-delay: {phase !== 'form' ? '0ms' : '180ms'};
			"
		>
			<div class="flex flex-col" style="gap: 10px;">
				<PrimaryButton type="submit" disabled={sending} loading={sending}>
					<span style="white-space: nowrap;">
						{sending ? 'Sending your code' : 'Lower My Rent'}
					</span>
					{#if !sending}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<path
								d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</PrimaryButton>
				{#if formError}
					<div
						class="text-center"
						style="font-family: var(--font-sans); font-size: 12px; line-height: 1.45; color: rgba(192,57,43,0.92);"
					>
						{formError}
					</div>
				{/if}
				<div
					class="text-center"
					style="font-family: var(--font-sans); font-size: 12px; line-height: 1.45; color: rgba(30,30,40,0.5);"
				>
					We email a 6-digit code to verify it's you — no account, no password.
				</div>
			</div>
		</div>
	</div>

	<!-- Code entry — appears once a verification code is emailed, collapses
	     away on a successful verify. -->
	<div
		class="grid"
		style="
			grid-template-rows: {showOtp ? '1fr' : '0fr'};
			margin-bottom: {showOtp ? '18px' : '0px'};
			transition:
				grid-template-rows 380ms cubic-bezier(0.32,0.72,0,1),
				margin-bottom 380ms cubic-bezier(0.32,0.72,0,1);
		"
	>
		<div
			class="overflow-hidden"
			style="
				opacity: {showOtp ? 1 : 0};
				transition: opacity 220ms ease;
				transition-delay: {showOtp ? '180ms' : '0ms'};
			"
		>
			<div class="flex flex-col" style="gap: 12px;">
				<div
					style="font-family: var(--font-sans); font-size: 13px; line-height: 1.5; color: rgba(30,30,40,0.65);"
				>
					Enter the 6-digit code sent to
					<strong style="color: var(--ink); font-weight: 600;">{sentToEmail}</strong>
				</div>
				<OtpInput
					onComplete={onVerify}
					disabled={phase === 'verifying'}
					error={!!codeError}
					resetKey={otpResetKey}
				/>
				{#if codeError}
					<span
						style="font-family: var(--font-sans); font-size: 12px; color: rgba(192,57,43,0.92); padding-left: 2px;"
					>
						{codeError}
					</span>
				{/if}
				<div class="flex items-center" style="gap: 18px; padding-left: 2px;">
					<button
						type="button"
						onclick={() => sendCode(true)}
						disabled={sending}
						class="cursor-pointer"
						style="
							background: none; border: 0; padding: 0;
							font-family: var(--font-sans); font-size: 12px; font-weight: 600;
							letter-spacing: 0.3px; color: var(--accent-deep);
							opacity: {sending ? 0.5 : 1};
						"
					>
						{sending ? 'Sending…' : 'Resend code'}
					</button>
					<button
						type="button"
						onclick={useDifferentEmail}
						class="cursor-pointer"
						style="
							background: none; border: 0; padding: 0;
							font-family: var(--font-sans); font-size: 12px; font-weight: 600;
							letter-spacing: 0.3px; color: rgba(30,30,40,0.55);
						"
					>
						Use a different email
					</button>
				</div>
			</div>
		</div>
	</div>

	<!-- Wrapper handles the 150 ms fade-swap when the user picks a different
	     version. The particle canvas keeps rendering underneath; only the
	     composite opacity ramps to 0 and back. -->
	<div style="opacity: {swapping ? 0 : 1}; transition: opacity 150ms ease;">
		<InvisibleInk
			value={notes}
			onChange={(v) => (notes = v)}
			height={inkHeight}
			dissolved={verified}
		/>
	</div>

	<!-- Invisible Cloudflare Turnstile — zero visual footprint; produces a
	     token in the background. Keyed on turnstileNonce so a resend remounts
	     the widget for a fresh, single-use token. -->
	{#key turnstileNonce}
		<Turnstile onToken={(t) => (turnstileToken = t)} />
	{/key}
</form>
