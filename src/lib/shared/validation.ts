import { z } from 'zod';
import { APT_TYPES } from './apt-types';

export const aptTypeSchema = z.enum(APT_TYPES);

export const submissionSchema = z.object({
	address: z.string().trim().min(8, 'Enter your full address.').max(200),
	aptType: aptTypeSchema,
	rentCents: z
		.number()
		.int()
		.min(30_000, 'Rent seems too low — did you enter dollars?')
		.max(2_000_000, 'Rent seems implausibly high.'),
	leaseExpiry: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.')
		.refine((s) => {
			const d = new Date(s + 'T00:00:00Z');
			const today = new Date();
			today.setUTCHours(0, 0, 0, 0);
			return !Number.isNaN(d.getTime()) && d.getTime() >= today.getTime();
		}, 'Lease expiry must be today or later.')
});

export type SubmissionPayload = z.infer<typeof submissionSchema>;

// Email-verification inputs — shared by the client form and the
// /api/verify/* endpoints. Email is trimmed + lowercased so the value that
// reaches hashing/storage is already normalized.
export const emailSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(3, 'Enter your email address.')
	.max(254, 'That email address is too long.')
	.refine((v) => z.email().safeParse(v).success, 'Enter a valid email address.');

export const verificationCodeSchema = z
	.string()
	.trim()
	.regex(/^\d{6}$/, 'Enter the 6-digit code.');
