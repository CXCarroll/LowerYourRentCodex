/**
 * Seed `email_templates` with 4 starter negotiation-email variations, each
 * tagged with the tenant audience it targets (above-market / below-market /
 * any) and an aggressiveness tier (baseline / more_aggressive / very_aggressive),
 * rewritten with {{placeholder}} variables.
 *
 * Idempotent: does nothing if the table already has any rows, so it's safe to
 * run after the admin has started composing their own templates.
 *
 * Run: bun run scripts/seed-email-templates.ts   (or  bun run seed:templates)
 */

import { emailTemplates } from '../src/lib/server/db/schema';
import { getDb, log } from './_seed-helpers';

const STARTERS: Array<{
	name: string;
	body: string;
	audience: 'any' | 'above_median' | 'below_median';
	aggressiveness: 'baseline' | 'more_aggressive' | 'very_aggressive';
}> = [
	{
		name: 'Open conversation',
		audience: 'any',
		aggressiveness: 'baseline',
		body: `Hi [Landlord name],

I hope you're doing well. My lease at {{address}} is up for renewal soon, and I wanted to open a conversation about the renewal rate.

After reviewing local data — including HUD Fair Market Rent figures and the American Community Survey's median rent for comparable {{apt_type}} units in this ZIP — my current rent of {{current_rent}} appears to be about {{pct_above_median}}% {{median_direction}} the neighborhood median of {{median_rent}}.

{{supply_context}}

I'd like to propose renewing at {{proposed_rent}}/month. I've been a reliable tenant, always paid on time, and I'd prefer to renew rather than move. If that's not workable, I could make {{fallback_rent}} work on a 12-month renewal.

Happy to hop on a quick call. Thanks for considering.

— [Your name]`
	},
	{
		name: 'Would like to stay',
		audience: 'above_median',
		aggressiveness: 'more_aggressive',
		body: `Hi [Landlord name],

I hope you're doing well. My lease at {{address}} is coming up for renewal, and I wanted to reach out before making any decisions about my next steps.

After reviewing local data — including HUD Fair Market Rent figures and the American Community Survey's median rent for comparable {{apt_type}} units in this ZIP — my current rent of {{current_rent}} appears to be about {{pct_above_median}}% {{median_direction}} the neighborhood median of {{median_rent}}. Several comparable units in the area are available in that range, and I'm actively weighing my options.

{{supply_context}}

I'd like to stay — I've been a consistent, on-time tenant and I value the stability of not having to move. But I also can't responsibly renew at a rate this far above market. I'd like to propose renewing at {{proposed_rent}}/month. If that's not workable, I could stretch to {{fallback_rent}} on a 12-month term, but at the current rate I'll need to start looking elsewhere.

Happy to hop on a quick call to talk it through. I'd rather work something out than have to move, so I hope we can find a number that works for both of us.

— [Your name]`
	},
	{
		name: 'Planning a move',
		audience: 'above_median',
		aggressiveness: 'very_aggressive',
		body: `Hi [Landlord name],

I hope you're doing well. I wanted to reach out as my lease at {{address}} approaches renewal — I've begun planning a move, but wanted to have an honest conversation before finalizing anything, because staying is still an option if the numbers make sense.

After reviewing local data — including HUD Fair Market Rent figures and the American Community Survey's median rent for comparable {{apt_type}} units in this ZIP — my current rent of {{current_rent}} is approximately {{pct_above_median}}% {{median_direction}} the neighborhood median of {{median_rent}}. That gap is the main driver behind my decision to start exploring other options.

{{supply_context}}

I know that turning over a unit comes with real costs — vacancy loss, listing fees, cleaning, and the time it takes to find and vet a new tenant. By some estimates, that can run a landlord the equivalent of one to two months' rent. A modest reduction for a reliable, proven tenant is often the better deal for both sides.

If you're open to renewing at {{proposed_rent}}/month, I'd be glad to stay and sign a 12-month lease. I could also make {{fallback_rent}} work if that's a better fit. Either way, I wanted to give you the first opportunity rather than just turning in my notice.

Let me know if you'd like to talk through it.

— [Your name]`
	},
	{
		name: 'Resisting a large increase',
		audience: 'below_median',
		aggressiveness: 'baseline',
		body: `Hi [Landlord name],

I hope you're doing well. My lease at {{address}} is up for renewal soon, and I wanted to reach out early to talk through the renewal rate.

I recognize that my current rent of {{current_rent}} sits about {{pct_above_median}}% {{median_direction}} the neighborhood median of {{median_rent}} for comparable {{apt_type}} units, so I understand some adjustment may be on the table. My hope is simply that any increase stays modest and gradual.

{{supply_context}}

I've been a reliable tenant — always paid on time, taken care of the unit, and I'd genuinely like to stay. Turning over a unit isn't free: vacancy loss, listing fees, cleaning, and the time to screen a new tenant can add up to one to two months' rent. A measured renewal keeps a proven, low-risk tenant in place and avoids all of that.

If we can keep the renewal reasonable, I'd be glad to sign a 12-month lease. Happy to hop on a quick call to find a number that works for both of us.

— [Your name]`
	}
];

async function main() {
	const { db, close } = getDb();
	try {
		const existing = await db.select({ id: emailTemplates.id }).from(emailTemplates).limit(1);
		if (existing.length > 0) {
			log('skip', 'email_templates already has rows — leaving them untouched.');
			return;
		}
		await db
			.insert(emailTemplates)
			.values(
				STARTERS.map((t) => ({
					name: t.name,
					body: t.body,
					audience: t.audience,
					aggressiveness: t.aggressiveness,
					status: 'active' as const
				}))
			);
		log('done', `inserted ${STARTERS.length} active starter templates.`);
	} finally {
		await close();
	}
}

await main();
