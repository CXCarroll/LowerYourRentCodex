import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { assertDb } from '$lib/server/db/client';
import { emailTemplates } from '$lib/server/db/schema';

export const load: PageServerLoad = async () => {
	const db = assertDb();
	const templates = await db
		.select({
			id: emailTemplates.id,
			name: emailTemplates.name,
			status: emailTemplates.status,
			audience: emailTemplates.audience,
			aggressiveness: emailTemplates.aggressiveness,
			updatedAt: emailTemplates.updatedAt
		})
		.from(emailTemplates)
		.orderBy(desc(emailTemplates.updatedAt));
	const activeCount = templates.filter((t) => t.status === 'active').length;
	return { templates, activeCount };
};
