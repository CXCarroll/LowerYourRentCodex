declare module 'parse-address' {
	export interface ParsedAddress {
		number?: string;
		prefix?: string;
		street?: string;
		type?: string;
		suffix?: string;
		city?: string;
		state?: string;
		zip?: string;
		plus4?: string;
		sec_unit_type?: string;
		sec_unit_num?: string;
	}
	export function parseLocation(input: string): ParsedAddress | null;
	export function parseAddress(input: string): ParsedAddress | null;
	export function parseInformalAddress(input: string): ParsedAddress | null;
	export function parseIntersection(input: string): ParsedAddress | null;
}
