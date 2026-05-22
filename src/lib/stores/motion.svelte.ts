interface ReducedMotionState {
	enabled: boolean;
}

export const reducedMotion = $state<ReducedMotionState>({
	enabled: false
});

let stopWatching: (() => void) | null = null;

export function initReducedMotion() {
	if (typeof window === 'undefined') return () => {};
	if (stopWatching) return stopWatching;

	const query = window.matchMedia('(prefers-reduced-motion: reduce)');
	const sync = () => {
		reducedMotion.enabled = query.matches;
	};

	sync();
	query.addEventListener('change', sync);

	stopWatching = () => {
		query.removeEventListener('change', sync);
		stopWatching = null;
	};

	return stopWatching;
}
