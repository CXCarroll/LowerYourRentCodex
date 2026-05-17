import { redirect, type RequestHandler } from '@sveltejs/kit';
import { revokeAdminSession } from '$lib/server/admin/auth';

// POST only. Form action is `<form method="POST" action="/admin/logout">`.
// A GET handler would let link-prefetchers log the admin out.
export const POST: RequestHandler = async ({ cookies }) => {
	await revokeAdminSession(cookies);
	throw redirect(303, '/admin/login');
};
