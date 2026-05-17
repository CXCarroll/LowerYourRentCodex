<script lang="ts">
	// "Invisible ink" textarea with a particle-canvas obscurer.
	//
	// Faithful port of screens.jsx InvisibleInk (which itself ports
	// tomdanvers/jWErVo on CodePen). Behaviour:
	//
	//  - On mount: a grey particle field drifts downward across the field,
	//    obscuring the textarea text (which renders at color: transparent).
	//  - Tap (and !dissolved) reveals the underlying text for ~3.5 s by
	//    fading particle alpha to 0; the canvas itself still runs.
	//  - When `dissolved` flips true (after OTP verification in the form):
	//      * particles snap angle to π/2 and ease speed toward a target
	//        that drains the visible area in roughly 6 s,
	//      * they stop respawning at the top so the field clears for good,
	//      * the textarea color snaps opaque so each character typed by the
	//        parent's typewriter effect appears immediately.
	//  - The centred "YOUR RENT NEGOTIATION WILL APPEAR HERE" overlay is
	//    rendered while pre-reveal/pre-dissolve to mask the empty state.

	interface Props {
		value: string;
		onChange: (v: string) => void;
		placeholder?: string;
		/** Px height of the field. Tweens smoothly when the parent recomputes it. */
		height?: number;
		/** Flip true to end the particle animation and reveal the textarea. */
		dissolved?: boolean;
	}

	const {
		value,
		onChange,
		placeholder = '',
		height = 220,
		dissolved = false
	}: Props = $props();

	const PADX = 16;
	const PADY = 14;
	const LINE_H = 22;
	const FONT_SIZE = 15;

	let wrapEl: HTMLDivElement | undefined = $state();
	let canvasEl: HTMLCanvasElement | undefined = $state();

	let revealed = $state(false);
	let focused = $state(false);

	// The rAF tick reads `dissolved` via a plain ref-style variable so we
	// don't need to tear down and rebuild the loop every time it flips.
	let dissolvedRef = false;
	$effect(() => {
		dissolvedRef = dissolved;
	});

	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	function reveal() {
		if (dissolved) return;
		revealed = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (revealed = false), 3500);
	}

	$effect(() => {
		return () => {
			if (hideTimer) clearTimeout(hideTimer);
		};
	});

	// Particle simulation. Mounts once; never restarts when reactive state
	// changes — the loop reads from `dissolvedRef` and the latest reveal
	// target via the closure-captured `targetReveal` setter below.
	let targetReveal = 0;
	$effect(() => {
		targetReveal = dissolved ? 0 : revealed || focused ? 1 : 0;
	});

	$effect(() => {
		const wrap = wrapEl;
		const canvas = canvasEl;
		if (!wrap || !canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);

		let W = 0;
		let H = 0;

		function setup() {
			const rect = wrap!.getBoundingClientRect();
			W = rect.width;
			H = rect.height;
			canvas!.width = Math.round(W * dpr);
			canvas!.height = Math.round(H * dpr);
			canvas!.style.width = W + 'px';
			canvas!.style.height = H + 'px';
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		setup();

		// Tunables — copied from the prototype's halved values.
		const SCALE = 0.9;
		const MIN_SPEED = 0.25 * SCALE;
		const MAX_SPEED = 0.5 * SCALE;
		const MIN_SIZE = 0.25 * SCALE;
		const MAX_SIZE = 1.5 * SCALE;
		let SPEED_MODIFY_RADIUS = 120;

		const mouse = {
			x: null as number | null,
			y: null as number | null,
			angle: 0,
			speedTarget: 0,
			speedCurrent: 0,
			speedValue: 0
		};

		function dist(a: { x: number | null; y: number | null }, b: { x: number; y: number }) {
			if (a.x == null || a.y == null) return Infinity;
			const x = a.x - b.x;
			const y = a.y - b.y;
			return Math.sqrt(x * x + y * y);
		}

		interface Particle {
			x: number;
			y: number;
			z: number;
			angleLerp: number;
			angleBase: number;
			angle: number;
			angleModifier: number;
			timeModifier: number;
			speedBase: number;
			speed: number;
			size: number;
		}

		function makeParticle(): Particle {
			const z = Math.random();
			return {
				x: Math.random() * W,
				y: Math.random() * H,
				z,
				angleLerp: 0.025 + Math.random() * 0.05,
				angleBase: Math.PI * 0.5,
				angle: Math.PI * 0.5,
				angleModifier: Math.random() > 0.5 ? -Math.random() - 0.5 : Math.random() + 0.5,
				timeModifier: Math.random(),
				speedBase: MIN_SPEED + MAX_SPEED * z,
				speed: MIN_SPEED + MAX_SPEED * z,
				size: MIN_SIZE + MAX_SIZE * z
			};
		}

		function makeParticles() {
			const n = Math.max(450, Math.floor((W * H) / 12));
			return Array.from({ length: n }, makeParticle);
		}

		let particles = makeParticles();

		// Don't resize the canvas inside the RO callback — per the HTML spec
		// RO callbacks fire AFTER rAF callbacks but BEFORE paint, so resizing
		// here would clear the buffer that `tick()` just drew, producing a
		// white frame on every tween step. Flip a flag instead and let the
		// next `tick()` resize + redraw atomically before the next paint.
		let pendingResize = false;
		const ro = new ResizeObserver(() => {
			pendingResize = true;
		});
		ro.observe(wrap);

		function applyResize() {
			const prevH = H;
			setup();
			if (dissolvedRef) return;
			const targetCount = Math.max(450, Math.floor((W * H) / 12));
			if (particles.length < targetCount) {
				const need = targetCount - particles.length;
				for (let i = 0; i < need; i++) {
					const p = makeParticle();
					// Spawn new particles only in the newly-revealed band so
					// the existing field reads as continuous.
					if (H > prevH) p.y = prevH + Math.random() * (H - prevH);
					particles.push(p);
				}
			} else if (particles.length > targetCount) {
				particles.length = targetCount;
			}
		}

		function onMove(e: MouseEvent) {
			const rect = wrap!.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			if (mouse.x != null && mouse.y != null) {
				mouse.speedTarget = Math.min(dist(mouse, { x, y }), 20);
				mouse.angle = Math.atan2(y - mouse.y, x - mouse.x);
			}
			mouse.x = x;
			mouse.y = y;
		}
		function onLeave() {
			mouse.x = null;
			mouse.y = null;
			mouse.speedTarget = 0;
		}
		wrap.addEventListener('mousemove', onMove);
		wrap.addEventListener('mouseleave', onLeave);

		let revealCurrent = 0;
		let raf = 0;
		function tick(time: number) {
			if (pendingResize) {
				// Resize + draw must happen in the same tick so the next paint
				// sees a populated canvas, never a blank one.
				applyResize();
				pendingResize = false;
			}
			revealCurrent += (targetReveal - revealCurrent) * 0.08;
			const alpha = 1 - revealCurrent;

			ctx!.clearRect(0, 0, W, H);

			mouse.speedTarget *= 0.95;
			mouse.speedCurrent += (mouse.speedTarget - mouse.speedCurrent) * 0.9;
			mouse.speedValue = mouse.speedCurrent < 5 ? mouse.speedCurrent / 5 : 5;
			SPEED_MODIFY_RADIUS = Math.max(40, mouse.speedCurrent * 5);

			ctx!.fillStyle = 'grey';
			ctx!.globalAlpha = alpha;

			for (const p of particles) {
				if (dissolvedRef) {
					// Dissolve cascade: snap downward, accelerate, no respawn.
					p.angle += (Math.PI * 0.5 - p.angle) * 0.2;
					const fallSpeed = (1.3 + p.z * 0.8) * SCALE;
					p.speed += (fallSpeed - p.speed) * 0.06;
				} else {
					if (mouse.x != null) {
						const d = dist(p, mouse as { x: number; y: number });
						if (d < SPEED_MODIFY_RADIUS) {
							const speedEffect =
								(1 - d / SPEED_MODIFY_RADIUS) * (1 + mouse.speedValue) * 0.5;
							p.speed += (speedEffect - p.speed) * 0.15;
							p.angle += p.angleModifier * p.size * mouse.speedValue * 0.02;
						}
					}
					p.speed += (p.speedBase - p.speed) * 0.1;
					p.angle += (p.angleBase - p.angle) * p.angleLerp;
				}

				const amod =
					p.angle + Math.cos(time * p.timeModifier * 0.001) * (dissolvedRef ? 0.05 : 0.25);
				p.x += Math.cos(amod) * p.speed;
				p.y += Math.sin(amod) * p.speed;

				if (p.y > H + 10 || p.x < -10 || p.x > W + 10) {
					if (dissolvedRef) {
						p.x = -9999;
						p.y = -9999;
						p.speed = 0;
						continue;
					}
					p.y = -10;
					p.x = Math.random() * W;
				}

				ctx!.fillRect(p.x, p.y, p.size, p.size);
			}

			ctx!.globalAlpha = 1;
			raf = requestAnimationFrame(tick);
		}
		raf = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			wrap.removeEventListener('mousemove', onMove);
			wrap.removeEventListener('mouseleave', onLeave);
		};
	});

	const isEmpty = $derived(!value);
	const showText = $derived(dissolved || revealed || focused);
</script>

<div
	bind:this={wrapEl}
	onclick={reveal}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') reveal();
	}}
	role="button"
	tabindex="-1"
	style="
		position: relative;
		height: {height}px;
		border-radius: 16px;
		overflow: hidden;
		background: #FFFFFF;
		border: 0.5px solid {focused ? 'rgba(30,30,40,0.25)' : 'rgba(30,30,40,0.1)'};
		box-shadow: {focused
		? 'inset 0 1px 0 rgba(255,255,255,0.9), 0 0 0 4px rgba(30,30,40,0.06)'
		: 'inset 0 1px 0 rgba(255,255,255,0.9)'};
		cursor: text;
		transition: background 180ms, border 180ms, box-shadow 180ms,
			height 340ms cubic-bezier(0.32,0.72,0,1);
	"
>
	<textarea
		{value}
		oninput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
		spellcheck="false"
		style="
			position: absolute; inset: 0;
			width: 100%; height: 100%;
			padding: {PADY}px {PADX}px;
			border: none; outline: none; background: transparent; resize: none;
			font-family: var(--font-sans);
			font-size: {FONT_SIZE}px;
			line-height: {LINE_H}px;
			font-weight: 500;
			color: {dissolved ? 'var(--ink)' : showText ? 'var(--ink)' : 'transparent'};
			caret-color: var(--accent-deep);
			letter-spacing: -0.1px;
			transition: {dissolved ? 'color 280ms ease' : 'color 360ms ease'};
		"
	></textarea>

	{#if isEmpty && !focused && !dissolved}
		<div
			class="pointer-events-none"
			style="
				position: absolute;
				top: {PADY}px; left: {PADX}px; right: {PADX}px;
				font-family: var(--font-sans);
				font-size: {FONT_SIZE}px;
				line-height: {LINE_H}px;
				font-weight: 500;
				color: rgba(30,30,40,0.35);
				letter-spacing: -0.1px;
			"
		>
			{placeholder}
		</div>
	{/if}

	<canvas
		bind:this={canvasEl}
		class="pointer-events-none"
		style="position: absolute; inset: 0;"
	></canvas>

	{#if !showText && !isEmpty && !dissolved}
		<div
			class="pointer-events-none text-center"
			style="
				position: absolute; bottom: 10px; left: 0; right: 0;
				font-family: var(--font-mono);
				font-size: 9px;
				letter-spacing: 1.2px;
				text-transform: uppercase;
				color: rgba(30,30,40,0.55);
				font-weight: 600;
			"
		>
			Tap to reveal
		</div>
	{/if}
</div>
