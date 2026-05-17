/**
 * Run every seed script in order, stopping at the first fatal error.
 * Downloads are cached in .cache/seed/, so reruns are fast.
 *
 * Usage: bun run scripts/seed-all.ts
 */

import { log } from './_seed-helpers';

const STEPS = [
	{ name: 'zip-county', path: './seed-zip-county.ts' },
	{ name: 'hud-fmr', path: './seed-hud-fmr.ts' },
	{ name: 'acs-rent', path: './seed-acs-rent.ts' },
	{ name: 'vacancy', path: './seed-vacancy.ts' },
	{ name: 'permits', path: './seed-permits.ts' },
	{ name: 'population', path: './seed-population.ts' }
] as const;

for (const step of STEPS) {
	log('seed', `— ${step.name} —`);
	try {
		await import(step.path);
	} catch (err) {
		log('fail', `${step.name}: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
}

log('seed', 'all steps complete');
