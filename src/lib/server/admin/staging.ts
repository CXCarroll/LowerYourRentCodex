import { and, eq, gt, lt } from 'drizzle-orm';
import { assertDb } from '$lib/server/db/client';
import { adminUploadStaging } from '$lib/server/db/schema';
import { APT_TYPES } from '$lib/shared/apt-types';
import type { VacancyRowInput } from './vacancy-csv';
import type { FmrRowInput } from './fmr-csv';
import type { AcsRentRowInput } from './acs-csv';

export type StagedKind = 'vacancy_rates' | 'hud_fmr' | 'acs_rent';

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
	expiresAt: number;
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

export interface StagedAcsRentUpload extends StagedCommon {
	kind: 'acs_rent';
	validRows: AcsRentRowInput[];
	sample: AcsRentRowInput[];
}

export type StagedUpload = StagedVacancyUpload | StagedFmrUpload | StagedAcsRentUpload;

const TTL_MS = 15 * 60 * 1000;
const SAMPLE_LIMIT = 10;
const APT_TYPE_SET = new Set<string>(APT_TYPES);

type DbClient = ReturnType<typeof assertDb>;
type TxClient = Parameters<Parameters<DbClient['transaction']>[0]>[0];
type StagedVacancyInsert = Omit<StagedVacancyUpload, 'id' | 'createdAt' | 'expiresAt' | 'sample'>;
type StagedFmrInsert = Omit<StagedFmrUpload, 'id' | 'createdAt' | 'expiresAt' | 'sample'>;
type StagedAcsRentInsert = Omit<StagedAcsRentUpload, 'id' | 'createdAt' | 'expiresAt' | 'sample'>;
type StagedInsert = StagedVacancyInsert | StagedFmrInsert | StagedAcsRentInsert;
type StagedRow = typeof adminUploadStaging.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isVacancyRows(value: unknown): value is VacancyRowInput[] {
	return (
		Array.isArray(value) &&
		value.every(
			(row) =>
				isRecord(row) &&
				isInteger(row.year) &&
				isInteger(row.quarter) &&
				typeof row.cbsaCode === 'string' &&
				isFiniteNumber(row.rentalVacancyPct)
		)
	);
}

function isFmrRows(value: unknown): value is FmrRowInput[] {
	return (
		Array.isArray(value) &&
		value.every(
			(row) =>
				isRecord(row) &&
				isInteger(row.year) &&
				typeof row.countyFips === 'string' &&
				typeof row.aptType === 'string' &&
				APT_TYPE_SET.has(row.aptType) &&
				isInteger(row.fmrCents)
		)
	);
}

function isAcsRentRows(value: unknown): value is AcsRentRowInput[] {
	return (
		Array.isArray(value) &&
		value.every(
			(row) =>
				isRecord(row) &&
				isInteger(row.year) &&
				(row.geoLevel === 'zcta' || row.geoLevel === 'puma') &&
				typeof row.geoId === 'string' &&
				isInteger(row.medianGrossRentCents) &&
				(row.sampleSize === null || isInteger(row.sampleSize))
		)
	);
}

function toStagedUpload(row: StagedRow): StagedUpload {
	const common = {
		id: row.id,
		rowCount: row.rowCount,
		errorCount: row.errorCount,
		warningCount: row.warningCount,
		insertCount: row.insertCount,
		updateCount: row.updateCount,
		fileSha256: row.fileSha256,
		filename: row.filename,
		createdAt: row.createdAt.getTime(),
		expiresAt: row.expiresAt.getTime(),
		adminTokenHash: row.adminTokenHash
	};

	if (row.kind === 'vacancy_rates') {
		if (!isVacancyRows(row.parsedPayload)) {
			throw new Error('Staged vacancy upload payload is malformed.');
		}
		return {
			...common,
			kind: 'vacancy_rates',
			validRows: row.parsedPayload,
			sample: row.parsedPayload.slice(0, SAMPLE_LIMIT)
		};
	}

	if (row.kind === 'hud_fmr') {
		if (!isFmrRows(row.parsedPayload)) {
			throw new Error('Staged FMR upload payload is malformed.');
		}
		return {
			...common,
			kind: 'hud_fmr',
			validRows: row.parsedPayload,
			sample: row.parsedPayload.slice(0, SAMPLE_LIMIT)
		};
	}

	if (row.kind === 'acs_rent') {
		if (!isAcsRentRows(row.parsedPayload)) {
			throw new Error('Staged ACS rent upload payload is malformed.');
		}
		return {
			...common,
			kind: 'acs_rent',
			validRows: row.parsedPayload,
			sample: row.parsedPayload.slice(0, SAMPLE_LIMIT)
		};
	}

	throw new Error(`Unknown staged upload kind: ${row.kind}`);
}

export async function stageUpload(input: StagedVacancyInsert): Promise<StagedVacancyUpload>;
export async function stageUpload(input: StagedFmrInsert): Promise<StagedFmrUpload>;
export async function stageUpload(input: StagedAcsRentInsert): Promise<StagedAcsRentUpload>;
export async function stageUpload(input: StagedInsert): Promise<StagedUpload> {
	const db = assertDb();
	await reapExpiredStagedUploads();

	const expiresAt = new Date(Date.now() + TTL_MS);
	const [row] = await db
		.insert(adminUploadStaging)
		.values({
			adminTokenHash: input.adminTokenHash,
			kind: input.kind,
			filename: input.filename,
			fileSha256: input.fileSha256,
			parsedPayload: input.validRows,
			rowCount: input.rowCount,
			errorCount: input.errorCount,
			warningCount: input.warningCount,
			insertCount: input.insertCount,
			updateCount: input.updateCount,
			expiresAt
		})
		.returning();

	return toStagedUpload(row);
}

export async function peekStaged(id: string, adminTokenHash: string): Promise<StagedUpload | null> {
	const db = assertDb();
	await reapExpiredStagedUploads();
	const [row] = await db
		.select()
		.from(adminUploadStaging)
		.where(
			and(
				eq(adminUploadStaging.id, id),
				eq(adminUploadStaging.adminTokenHash, adminTokenHash),
				gt(adminUploadStaging.expiresAt, new Date())
			)
		)
		.limit(1);
	return row ? toStagedUpload(row) : null;
}

export async function consumeStaged(
	tx: TxClient,
	id: string,
	adminTokenHash: string,
	kind: 'vacancy_rates'
): Promise<StagedVacancyUpload | null>;
export async function consumeStaged(
	tx: TxClient,
	id: string,
	adminTokenHash: string,
	kind: 'hud_fmr'
): Promise<StagedFmrUpload | null>;
export async function consumeStaged(
	tx: TxClient,
	id: string,
	adminTokenHash: string,
	kind: 'acs_rent'
): Promise<StagedAcsRentUpload | null>;
export async function consumeStaged(
	tx: TxClient,
	id: string,
	adminTokenHash: string,
	kind: StagedKind
): Promise<StagedUpload | null> {
	const [row] = await tx
		.delete(adminUploadStaging)
		.where(
			and(
				eq(adminUploadStaging.id, id),
				eq(adminUploadStaging.adminTokenHash, adminTokenHash),
				eq(adminUploadStaging.kind, kind),
				gt(adminUploadStaging.expiresAt, new Date())
			)
		)
		.returning();
	return row ? toStagedUpload(row) : null;
}

export async function reapExpiredStagedUploads(): Promise<number> {
	const db = assertDb();
	const result = await db
		.delete(adminUploadStaging)
		.where(lt(adminUploadStaging.expiresAt, new Date()))
		.returning({ id: adminUploadStaging.id });
	return result.length;
}

/** For tests. */
export async function _resetStaging(): Promise<void> {
	const db = assertDb();
	await db.delete(adminUploadStaging);
}
