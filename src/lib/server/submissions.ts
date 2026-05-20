// Submission persistence.
//
// Privacy note: `submissions` rows are fully anonymous — no column links a row
// back to a person. Soft duplicate detection is keyed only on a hash of the
// building address.

import { and, eq, gte, sql } from 'drizzle-orm';
import { assertDb } from './db/client';
import { submissions } from './db/schema';
import type { AptType } from '$lib/shared/apt-types';

type DbClient = ReturnType<typeof assertDb>;
type TxClient = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export interface InsertSubmissionArgs {
	buildingAddress: string;
	addressHash: string;
	zip: string;
	countyFips: string | null;
	cbsaCode: string | null;
	aptType: AptType;
	rentCents: number;
	leaseExpiry: string; // ISO date
}

export async function insertSubmission(args: InsertSubmissionArgs): Promise<void> {
	const db = assertDb();
	await db.insert(submissions).values({
		buildingAddress: args.buildingAddress,
		addressHash: args.addressHash,
		zip: args.zip,
		countyFips: args.countyFips,
		cbsaCode: args.cbsaCode,
		aptType: args.aptType,
		rentCents: args.rentCents,
		leaseExpiry: args.leaseExpiry
	});
}

async function findRecentDuplicate(tx: Pick<DbClient, 'select'>, addressHash: string, aptType: AptType) {
	return tx
		.select({ id: submissions.id })
		.from(submissions)
		.where(
			and(
				eq(submissions.addressHash, addressHash),
				eq(submissions.aptType, aptType),
				gte(submissions.createdAt, sql`now() - interval '30 days'`)
			)
		)
		.limit(1);
}

/** Soft duplicate guard. If the same address+apt submitted in the last 30 days,
 * skip re-insert (don't pollute comps). Returns `true` if this insert was skipped. */
export async function isRecentDuplicate(
	addressHash: string,
	aptType: AptType
): Promise<boolean> {
	const db = assertDb();
	const rows = await findRecentDuplicate(db, addressHash, aptType);
	return rows.length > 0;
}

export async function insertSubmissionUnlessRecentDuplicateTx(
	tx: TxClient,
	args: InsertSubmissionArgs
): Promise<{ inserted: boolean }> {
	const duplicate = await findRecentDuplicate(tx, args.addressHash, args.aptType);
	if (duplicate.length > 0) return { inserted: false };

	await tx.insert(submissions).values({
		buildingAddress: args.buildingAddress,
		addressHash: args.addressHash,
		zip: args.zip,
		countyFips: args.countyFips,
		cbsaCode: args.cbsaCode,
		aptType: args.aptType,
		rentCents: args.rentCents,
		leaseExpiry: args.leaseExpiry
	});
	return { inserted: true };
}
