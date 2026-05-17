// Global design-tweaks state. Used by the dev-only TweaksPanel + reactive glass tokens.
//
// These three values parameterize the entire glass design system:
//   - palette: 4 atmospheric backdrops (sage / dusk / sunset / mono)
//   - accentHue: OKLCH hue angle for the forest / indigo / clay / plum / amber accent
//   - glassIntensity: alpha for rgba(255,255,255,X) on every glass surface (0.25–0.9)

export type Palette = 'sage' | 'dusk' | 'sunset' | 'mono';

interface TweaksState {
	palette: Palette;
	accentHue: number;
	glassIntensity: number;
}

const DEFAULTS: TweaksState = {
	palette: 'sage',
	accentHue: 155, // forest
	glassIntensity: 0.55
};

function load(): TweaksState {
	if (typeof localStorage === 'undefined') return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem('lyr:tweaks');
		if (!raw) return { ...DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<TweaksState>;
		return {
			palette: (parsed.palette ?? DEFAULTS.palette) as Palette,
			accentHue: typeof parsed.accentHue === 'number' ? parsed.accentHue : DEFAULTS.accentHue,
			glassIntensity:
				typeof parsed.glassIntensity === 'number' ? parsed.glassIntensity : DEFAULTS.glassIntensity
		};
	} catch {
		return { ...DEFAULTS };
	}
}

export const tweaks = $state<TweaksState>(load());

/** Persist changes to localStorage. Call from a root-level $effect. */
export function persistTweaks() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem('lyr:tweaks', JSON.stringify(tweaks));
	} catch {
		/* noop */
	}
}

/** Apply tweaks to :root CSS variables. Call from a root-level $effect. */
export function applyTweaksToRoot() {
	if (typeof document === 'undefined') return;
	const r = document.documentElement.style;
	r.setProperty('--accent-hue', String(tweaks.accentHue));
	r.setProperty('--glass-intensity', String(tweaks.glassIntensity));
	r.setProperty(
		'--glass-intensity-soft',
		String(Math.max(0.1, tweaks.glassIntensity - 0.2))
	);
	r.setProperty(
		'--glass-intensity-strong',
		String(Math.min(1, tweaks.glassIntensity + 0.3))
	);
	document.documentElement.dataset.palette = tweaks.palette;
}

export const PALETTES: Array<{
	id: Palette;
	label: string;
	swatch: string;
}> = [
	{ id: 'sage', label: 'Sage', swatch: 'linear-gradient(135deg, #7DA87D, #D6BA8C, #94A8C4)' },
	{ id: 'dusk', label: 'Dusk', swatch: 'linear-gradient(135deg, #A88CCC, #E8A8B8, #7898C4)' },
	{ id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg, #F0A078, #E8BC80, #C48CB4)' },
	{ id: 'mono', label: 'Mono', swatch: 'linear-gradient(135deg, #BDBDC4, #9A9AA0, #D0D0D4)' }
];

export const ACCENT_HUES: Array<{ h: number; name: string }> = [
	{ h: 155, name: 'Forest' },
	{ h: 220, name: 'Indigo' },
	{ h: 20, name: 'Clay' },
	{ h: 285, name: 'Plum' },
	{ h: 50, name: 'Amber' }
];
