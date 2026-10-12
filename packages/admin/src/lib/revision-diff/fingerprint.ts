import { fieldMode, slugOf, stagedReferences, valueKey } from "./fields.js";
import type { DiffFieldDescriptor, RevisionData, RevisionLike } from "./types.js";

type Fields = Readonly<Record<string, DiffFieldDescriptor>>;

const fingerprints = new WeakMap<Fields, WeakMap<RevisionData, string>>();

/**
 * The content of a revision as the diff sees it: equal fingerprints mean the diff would find no
 * field changes. Keys, `_` internals and relation-bound references don't count.
 */
export function fingerprint(data: RevisionData, fields: Fields): string {
	let byData = fingerprints.get(fields);
	if (!byData) {
		byData = new WeakMap();
		fingerprints.set(fields, byData);
	}
	let value = byData.get(data);
	if (value === undefined) {
		const parts: Array<[string, string]> = [];
		for (const [slug, descriptor] of Object.entries(fields)) {
			const mode = fieldMode(descriptor);
			if (mode === "relation") continue;
			const key = valueKey(mode, data[slug]);
			if (key !== null) parts.push([slug, key]);
		}
		value = JSON.stringify(parts);
		byData.set(data, value);
	}
	return value;
}

/** Whether the slug and staged references agree wherever both revisions record them. */
function compatibleInternals(a: RevisionData, b: RevisionData, fields: Fields): boolean {
	if (
		Object.hasOwn(a, "_slug") &&
		Object.hasOwn(b, "_slug") &&
		slugOf(a._slug) !== slugOf(b._slug)
	) {
		return false;
	}
	for (const [slug, descriptor] of Object.entries(fields)) {
		if (fieldMode(descriptor) !== "relation") continue;
		const left = stagedReferences(a, "_references", slug);
		const right = stagedReferences(b, "_references", slug);
		if (
			left !== undefined &&
			right !== undefined &&
			valueKey("value", left) !== valueKey("value", right)
		) {
			return false;
		}
	}
	return true;
}

function sameContent(a: RevisionData, b: RevisionData, fields: Fields): boolean {
	return fingerprint(a, fields) === fingerprint(b, fields) && compatibleInternals(a, b, fields);
}

/**
 * The id of the newest revision in `older` (newest first) whose content equals `current`, when
 * `current` differs from `previous`; otherwise null.
 */
export function findRestoredSource(
	current: RevisionLike,
	previous: RevisionLike | null,
	older: readonly RevisionLike[],
	fields: Fields,
): string | null {
	// Saving again without changes copies the previous version; that isn't a restore.
	if (!previous || sameContent(current.data, previous.data, fields)) return null;
	return older.find((revision) => sameContent(current.data, revision.data, fields))?.id ?? null;
}
