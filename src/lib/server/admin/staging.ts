// In-memory staging for the admin two-step upload flow.
// Lives in a single-process Map with 15-minute TTL. If the server restarts the admin
// just re-uploads — no persistence. Cap at 20 entries, LRU-evict on overflow.

import { randomUUID } from 'node:crypto';
import type { VacancyRowInput } from './vacancy-csv';
import type { FmrRowInput } from './fmr-csv';

export type StagedKind = 'vacancy_rates' | 'hud_fmr';

interface StagedCommon {
	id: string;
	rowCount: number;
	errorCount: number;
	warningCount: number;
	insertCount: number;
	updateCount: number;
	fileSha256: string;
	filename: string;
	createdAt: number;
	adminTokenHash: string; // commit must come from the same session
}

export interface StagedVacancyUpload extends StagedCommon {
	kind: 'vacancy_rates';
	validRows: VacancyRowInput[];
	sample: VacancyRowInput[];
}

export interface StagedFmrUpload extends StagedCommon {
	kind: 'hud_fmr';
	validRows: FmrRowInput[];
	sample: FmrRowInput[];
}

export type StagedUpload = StagedVacancyUpload | StagedFmrUpload;

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 20;

const staged = new Map<string, StagedUpload>();

function sweep(): void {
	const cutoff = Date.now() - TTL_MS;
	for (const [id, entry] of staged) {
		if (entry.createdAt < cutoff) staged.delete(id);
	}
	while (staged.size > MAX_ENTRIES) {
		const oldest = staged.keys().next().value;
		if (!oldest) break;
		staged.delete(oldest);
	}
}

export function stageUpload<T extends StagedUpload>(
	input: Omit<T, 'id' | 'createdAt'>
): T {
	sweep();
	const id = randomUUID();
	const entry = { ...input, id, createdAt: Date.now() } as T;
	staged.set(id, entry);
	return entry;
}

export function peekStaged(id: string, adminTokenHash: string): StagedUpload | null {
	sweep();
	const entry = staged.get(id);
	if (!entry) return null;
	if (entry.adminTokenHash !== adminTokenHash) return null;
	return entry;
}

export function consumeStaged(id: string, adminTokenHash: string): StagedUpload | null {
	const entry = peekStaged(id, adminTokenHash);
	if (!entry) return null;
	staged.delete(id);
	return entry;
}

/** For tests. */
export function _resetStaging(): void {
	staged.clear();
}
