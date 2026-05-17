import type { EmailTemplate, Proposal } from '$lib/shared/types';
import { APT_TYPE_LABEL, type AptType } from '$lib/shared/apt-types';

interface RenderInput {
	buildingAddress: string;
	zip: string;
	aptType: AptType;
	leaseExpiry: string; // ISO
	proposal: Proposal;
}

function formatDollars(cents: number): string {
	return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

function formatDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00Z');
	return d.toLocaleDateString('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}


export function renderEmail(input: RenderInput): EmailTemplate {
	const { buildingAddress, zip, aptType, leaseExpiry, proposal } = input;

	const subject = 'Lease renewal — request to revise rent';

	const body = [
		'Hi [Landlord],',
		'',
		`My lease at ${buildingAddress} expires on ${formatDate(leaseExpiry)} and I'd like to discuss renewing.`,
		'',
		`Looking at recent comparable rents in ${zip} for ${APT_TYPE_LABEL[aptType]} units, the market median is around ${formatDollars(proposal.targetCents)}/mo. My current rent is ${formatDollars(proposal.currentCents)}.`,
		'',
		`I'd like to propose renewing at ${formatDollars(proposal.lowCents)}/mo. I'm prepared to sign for 12 months and continue as a low-maintenance tenant.`,
		'',
		`If ${formatDollars(proposal.lowCents)} doesn't work, I'd consider up to ${formatDollars(proposal.walkAwayCents)}/mo.`,
		'',
		'Thanks,',
		'[Your name]'
	].join('\n');

	return { subject, body };
}
