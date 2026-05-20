// Submission persistence.
//
// Privacy note: `submissions` rows are fully anonymous — no column links a row
// back to a person. Soft duplicate detection is keyed only on a hash of the
// building address plus the unit hash when one was supplied.

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { assertDb } from './db/client';
import { submissionDedupeKeys, submissions } from './db/schema';
import type { AptType } from '$lib/shared/apt-types';

type DbClient = ReturnType<typeof assertDb>;
type TxClient = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export interface InsertSubmissionArgs {
	buildingAddress: string;
	addressHash: string;
	unitHash: string | null;
	zip: string;
	countyFips: string | null;
	cbsaCode: string | null;
	aptType: AptType;
	rentCents: number;
	leaseExpiry: string; // ISO date
}

export async function insertSubmission(args: InsertSubmissionArgs): Promise<void> {
	const db = assertDb();
	await db.transaction((tx) => insertSubmissionUnlessRecentDuplicateTx(tx, args));
}

function dedupeHash(addressHash: string, unitHash: string | null, aptType: AptType): string {
	return createHash('sha256')
		.update(addressHash)
		.update('\0')
		.update(unitHash ?? 'building')
		.update('\0')
		.update(aptType)
		.digest('hex');
}

/** Soft duplicate guard. If the same address+apt submitted in the last 30 days,
 * skip re-insert (don't pollute comps). Returns `true` if this insert was skipped. */
export async function isRecentDuplicate(
	addressHash: string,
	aptType: AptType,
	unitHash: string | null = null
): Promise<boolean> {
	const db = assertDb();
	const rows = await db
		.select({ dedupeHash: submissionDedupeKeys.dedupeHash })
		.from(submissionDedupeKeys)
		.where(
			sql`${submissionDedupeKeys.dedupeHash} = ${dedupeHash(addressHash, unitHash, aptType)}
				and ${submissionDedupeKeys.expiresAt} > now()`
		)
		.limit(1);
	return rows.length > 0;
}

export async function insertSubmissionUnlessRecentDuplicateTx(
	tx: TxClient,
	args: InsertSubmissionArgs
): Promise<{ inserted: boolean }> {
	const rows = (await tx.execute(sql`
		with acquired_key as (
			insert into ${submissionDedupeKeys} (
				dedupe_hash,
				address_hash,
				unit_hash,
				apt_type,
				expires_at,
				created_at,
				updated_at
			)
			values (
				${dedupeHash(args.addressHash, args.unitHash, args.aptType)},
				${args.addressHash},
				${args.unitHash},
				${args.aptType}::apt_type,
				now() + interval '30 days',
				now(),
				now()
			)
			on conflict (dedupe_hash) do update set
				address_hash = excluded.address_hash,
				unit_hash = excluded.unit_hash,
				apt_type = excluded.apt_type,
				expires_at = excluded.expires_at,
				updated_at = now()
			where ${submissionDedupeKeys.expiresAt} <= now()
			returning dedupe_hash
		),
		inserted_submission as (
			insert into ${submissions} (
				building_address,
				address_hash,
				zip,
				county_fips,
				cbsa_code,
				apt_type,
				rent_cents,
				lease_expiry
			)
			select
				${args.buildingAddress},
				${args.addressHash},
				${args.zip},
				${args.countyFips},
				${args.cbsaCode},
				${args.aptType}::apt_type,
				${args.rentCents},
				${args.leaseExpiry}::date
			from acquired_key
			returning id
		)
		select exists(select 1 from inserted_submission) as inserted
	`)) as unknown as Array<{ inserted: boolean }>;

	return { inserted: !!rows[0]?.inserted };
}
