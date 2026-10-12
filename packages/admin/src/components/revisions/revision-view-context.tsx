import * as React from "react";

import type { RevisionDiff } from "../../lib/revision-diff/types.js";

export interface RevisionViewContextValue {
	/** The revision shown in the canvas, or null while editing. */
	viewingId: string | null;
	/** The viewed revision compared with the one before it; null while editing. */
	viewingDiff: RevisionDiff | null;
	/** The revision the editor holds: the draft, or the live revision when there is no draft. */
	currentRevisionId: string | null;
	liveRevisionId: string | null;
	/** How many revisions the list asks for. */
	listLimit: number;
	showOlderVersions: () => void;
	/** Shows a revision in the canvas. `opener` gets focus back when the view closes. */
	view: (revisionId: string, options?: { opener?: HTMLElement | null }) => void;
	exit: () => void;
	/** Scrolls the canvas to a change's target and focuses it. */
	goToChange: (targetId: string) => void;
}

const RevisionViewContext = React.createContext<RevisionViewContextValue | null>(null);

export const RevisionViewProvider = RevisionViewContext.Provider;

/** Null outside the content editor, where the list renders without a canvas to show versions in. */
export function useRevisionViewContext(): RevisionViewContextValue | null {
	return React.useContext(RevisionViewContext);
}
