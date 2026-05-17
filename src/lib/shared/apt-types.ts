export const APT_TYPES = ['studio', '1br', '2br', '3br', '4br_plus'] as const;
export type AptType = (typeof APT_TYPES)[number];

export const APT_TYPE_LABEL: Record<AptType, string> = {
	studio: 'Studio',
	'1br': '1 bedroom',
	'2br': '2 bedroom',
	'3br': '3 bedroom',
	'4br_plus': '4+ bedroom'
};

export const APT_TYPE_OPTIONS = APT_TYPES.map((value) => ({
	value,
	label: APT_TYPE_LABEL[value]
}));
