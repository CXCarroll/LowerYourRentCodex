/**
 * Generate an argon2id hash for the admin password and print it to stdout.
 * Status messages go to stderr so you can do:
 *   bun run admin:password 2>/dev/null   (hash only)
 * or pipe into .env with:
 *   echo "ADMIN_PASSWORD_HASH=$(bun run admin:password 2>/dev/null)" >> .env
 *
 * Password sources (first wins):
 *   1. $ADMIN_PASSWORD env var (for CI)
 *   2. Interactive prompt (TTY, echo disabled)
 */

import { createInterface } from 'node:readline';
import argon2 from 'argon2';

const MIN_LEN = 12;

function err(msg: string): void {
	process.stderr.write(msg + '\n');
}

function validate(password: string): string | null {
	if (password.length < MIN_LEN) return `Password must be at least ${MIN_LEN} characters.`;
	if (!/\d/.test(password)) return 'Password must contain at least one digit.';
	if (!/[^\w\s]/.test(password)) return 'Password must contain at least one non-alphanumeric character.';
	return null;
}

async function promptPassword(): Promise<string> {
	if (!process.stdin.isTTY) {
		throw new Error('No TTY; set $ADMIN_PASSWORD to run non-interactively.');
	}
	const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
	// Mute echo by intercepting the output stream.
	const stdin = process.stdin;
	const wasRaw = stdin.isRaw ?? false;
	stdin.setRawMode?.(true);

	process.stderr.write('Admin password (hidden): ');
	return new Promise<string>((resolve, reject) => {
		let buf = '';
		const onData = (chunk: Buffer) => {
			const s = chunk.toString('utf8');
			for (const ch of s) {
				const code = ch.charCodeAt(0);
				if (code === 13 || code === 10) {
					// Enter
					stdin.removeListener('data', onData);
					stdin.setRawMode?.(wasRaw);
					rl.close();
					process.stderr.write('\n');
					resolve(buf);
					return;
				}
				if (code === 3) {
					// Ctrl-C
					stdin.removeListener('data', onData);
					stdin.setRawMode?.(wasRaw);
					rl.close();
					reject(new Error('Interrupted'));
					return;
				}
				if (code === 127 || code === 8) {
					// Backspace
					buf = buf.slice(0, -1);
					continue;
				}
				buf += ch;
			}
		};
		stdin.on('data', onData);
	});
}

async function main() {
	let password = process.env.ADMIN_PASSWORD;
	if (!password) {
		password = await promptPassword();
	}

	const problem = validate(password);
	if (problem) {
		err(`✗ ${problem}`);
		process.exit(1);
	}

	err('Hashing with argon2id (this takes ~1s)...');
	const hash = await argon2.hash(password, {
		type: argon2.argon2id,
		memoryCost: 65536,
		timeCost: 3,
		parallelism: 1
	});

	// Sanity check: the hash verifies
	const ok = await argon2.verify(hash, password);
	if (!ok) {
		err('✗ Internal error: hash failed self-verify.');
		process.exit(2);
	}

	// Bun's dotenv parser expands `$foo` in all quoting styles. Escape every `$`
	// with `\$` so the literal dollars survive.
	const envEscaped = hash.replace(/\$/g, '\\$');
	err('✓ Hash generated. Paste the line below into .env exactly as shown');
	err('  (the `\\$` escapes are required — Bun dotenv expands `$foo` otherwise):');
	err('');
	err(`ADMIN_PASSWORD_HASH=${envEscaped}`);
	err('');
	// ONLY the escaped .env value on stdout, so `>> .env` produces a usable line.
	process.stdout.write(envEscaped + '\n');
}

await main();
