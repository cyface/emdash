import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { ContentItem, RevisionListItem, RevisionListResponse } from "../../lib/api";
import { diffVersion } from "../../lib/revision-diff/index.js";
import type { DiffFieldDescriptor, RevisionDiff } from "../../lib/revision-diff/types.js";
import { isolate } from "../../lib/utils.js";
import {
	revisionAuthorColor,
	revisionAuthorColors,
	revisionDate,
	revisionTargetElementId,
	useRevisionFormat,
	type AuthorColor,
} from "./revision-format.js";
import {
	REVISION_LIST_LIMIT,
	REVISION_LIST_LIMIT_ALL,
	revisionsQueryOptions,
	visibleRevisionCount,
} from "./revision-query.js";
import type { RevisionViewContextValue } from "./revision-view-context.js";

export type RevisionStepDirection = "older" | "newer";

/** The phone settings sheet, reported from inside `Sidebar.Provider`. */
export interface RevisionViewSheet {
	isOpen: boolean;
	close: () => void;
}

export interface UseRevisionViewOptions {
	collection: string;
	entryId: string | undefined;
	locale: string | null | undefined;
	/** Whether the entry can show versions at all: saved, and in a collection with revisions. */
	enabled: boolean;
	draftRevisionId: string | null | undefined;
	liveRevisionId: string | null | undefined;
	fields: Readonly<Record<string, DiffFieldDescriptor>>;
	titleField?: string;
	/** Whether the Revisions list is on screen. It isn't on phones or in distraction-free mode. */
	listVisible: boolean;
	/** The editor's scrolling canvas. */
	canvasRef: React.RefObject<HTMLElement | null>;
	/** Runs before the editor is hidden. */
	onEnter?: () => void;
	/** Moves focus when the view closes and the row that opened it is gone or hidden. */
	onFocusFallback?: () => void;
}

export interface RevisionView {
	viewingId: string | null;
	/** The viewed revision, once the list holding it has loaded. */
	revision: RevisionListItem | null;
	diff: RevisionDiff | null;
	/** The diff for the viewed revision threw. */
	diffFailed: boolean;
	authorColor: AuthorColor;
	/** Accessible name for the shown version. */
	label: string;
	isCurrent: boolean;
	isPublished: boolean;
	hasOlder: boolean;
	hasNewer: boolean;
	showChanges: boolean;
	setShowChanges: (showChanges: boolean) => void;
	/** A restore has been accepted by the server and the editor is waiting for the restored draft. */
	restorePending: boolean;
	/** Text for a polite live region. */
	announcement: string;
	view: RevisionViewContextValue["view"];
	exit: () => void;
	step: (direction: RevisionStepDirection) => void;
	goToChange: (targetId: string) => void;
	/** Starts waiting for the editor to receive the item the server restored. */
	beginRestore: (restoredItem: Pick<ContentItem, "draftRevisionId">) => void;
	cancelRestore: () => void;
	/**
	 * Whether the editor's item is the one a pending restore produced: it points at a new draft
	 * revision, or, when restoring kept the same draft revision, the editor was told to reload.
	 */
	isRestoreArrival: (draftRevisionId: string | null | undefined, itemReset: boolean) => boolean;
	/** Closes the view after the editor has loaded the restored draft. */
	completeRestore: () => void;
	context: RevisionViewContextValue;
	sheetRef: React.MutableRefObject<RevisionViewSheet | null>;
	barTitleRef: React.RefObject<HTMLHeadingElement | null>;
	dockRef: React.RefObject<HTMLDivElement | null>;
}

const CHANGE_TOP_MARGIN_PX = 24;

type PendingScroll = "top" | "saved" | null;
type PendingFocus = "bar" | "opener" | "afterRestore" | null;

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isShown(element: HTMLElement): boolean {
	return (
		element.isConnected &&
		!element.closest("[inert], [aria-hidden='true']") &&
		element.getClientRects().length > 0
	);
}

function focusIsLost(canvas: HTMLElement | null): boolean {
	const active = document.activeElement;
	return !active || active === document.body || Boolean(canvas?.contains(active));
}

function restartPulse(element: HTMLElement) {
	element.classList.remove("emdash-revision-pulse");
	// Reading layout restarts the animation when the class goes back on.
	void element.offsetWidth;
	element.classList.add("emdash-revision-pulse");
	const stop = () => element.classList.remove("emdash-revision-pulse");
	element.addEventListener("animationend", stop, { once: true });
	element.addEventListener("blur", stop, { once: true });
}

/** State for showing a saved version in place of the editor. */
export function useRevisionView({
	collection,
	entryId,
	locale,
	enabled,
	draftRevisionId,
	liveRevisionId,
	fields,
	titleField,
	listVisible,
	canvasRef,
	onEnter,
	onFocusFallback,
}: UseRevisionViewOptions): RevisionView {
	const { t } = useLingui();
	const format = useRevisionFormat();
	const currentRevisionId = draftRevisionId ?? liveRevisionId ?? null;

	const [viewingId, setViewingId] = React.useState<string | null>(null);
	const [showChanges, setShowChangesState] = React.useState(true);
	const [listLimit, setListLimit] = React.useState(REVISION_LIST_LIMIT);
	const [restorePending, setRestorePending] = React.useState(false);
	const [announcement, setAnnouncement] = React.useState("");
	const [changeRequest, setChangeRequest] = React.useState(0);

	const identity = `${collection}:${entryId ?? ""}:${locale ?? ""}`;
	const [previousIdentity, setPreviousIdentity] = React.useState(identity);
	const restoreRef = React.useRef<{ fromDraftId: string | null; toDraftId: string | null } | null>(
		null,
	);
	if (identity !== previousIdentity) {
		setPreviousIdentity(identity);
		setViewingId(null);
		setListLimit(REVISION_LIST_LIMIT);
		setRestorePending(false);
		restoreRef.current = null;
	}

	const isViewing = enabled && viewingId !== null;
	const query = useQuery({
		...revisionsQueryOptions(collection, entryId ?? "", listLimit),
		enabled: isViewing && Boolean(entryId),
	});
	const list = query.data;

	const index = list && viewingId ? list.items.findIndex((item) => item.id === viewingId) : -1;
	const visibleCount = list ? visibleRevisionCount(list) : 0;
	const listIsPartial = Boolean(list && list.items.length < list.total);
	const canLoadOlder = listIsPartial && listLimit < REVISION_LIST_LIMIT_ALL;
	const loadingOlder =
		listIsPartial && listLimit >= REVISION_LIST_LIMIT_ALL && query.isPlaceholderData;
	// The last loaded revision of a partial list is there only to compare the one above it with.
	const comparable =
		index >= 0 &&
		(index < visibleCount || (listLimit >= REVISION_LIST_LIMIT_ALL && !query.isPlaceholderData));
	const hasOlder = comparable && (index + 1 < visibleCount || canLoadOlder || loadingOlder);
	const hasNewer = comparable && index > 0;

	const diffCacheRef = React.useRef<{
		list: RevisionListResponse;
		index: number;
		fields: UseRevisionViewOptions["fields"];
		locale: string | null | undefined;
		titleField: string | undefined;
		diff: RevisionDiff | null;
		failed: boolean;
	} | null>(null);
	const shownRef = React.useRef<{
		revision: RevisionListItem;
		diff: RevisionDiff | null;
		failed: boolean;
	} | null>(null);
	if (!isViewing) shownRef.current = null;
	let shown = null;
	const comparedRevision = comparable ? list?.items[index] : undefined;
	if (list && comparedRevision) {
		const cached = diffCacheRef.current;
		if (
			cached &&
			cached.list === list &&
			cached.index === index &&
			cached.fields === fields &&
			cached.locale === locale &&
			cached.titleField === titleField
		) {
			shown = { revision: comparedRevision, diff: cached.diff, failed: cached.failed };
		} else {
			let diff: RevisionDiff | null = null;
			let failed = false;
			try {
				diff = diffVersion({
					revisions: list.items,
					index,
					total: list.total,
					fields,
					locale: locale ?? undefined,
					titleField,
				});
			} catch (error) {
				console.error("[revisions] Failed to compare versions:", error);
				failed = true;
			}
			diffCacheRef.current = { list, index, fields, locale, titleField, diff, failed };
			shown = { revision: comparedRevision, diff, failed };
		}
		shownRef.current = shown;
	} else if (isViewing && shownRef.current?.revision.id === viewingId) {
		// A fuller list is loading; the comparison already on screen stays until it arrives.
		shown = shownRef.current;
	}
	const revision = isViewing ? (shown?.revision ?? null) : null;
	const diff = isViewing ? (shown?.diff ?? null) : null;
	const diffFailed = isViewing && Boolean(shown?.failed);

	const colors = React.useMemo(() => revisionAuthorColors(list?.items ?? []), [list?.items]);
	const authorColor: AuthorColor = revision ? revisionAuthorColor(colors, revision) : "neutral";
	const when = revision ? isolate(format.when(revisionDate(revision.createdAt))) : "";

	const viewingIdRef = React.useRef(viewingId);
	viewingIdRef.current = isViewing ? viewingId : null;
	const listRef = React.useRef(list);
	listRef.current = list;
	const listLimitRef = React.useRef(listLimit);
	listLimitRef.current = listLimit;
	const enabledRef = React.useRef(enabled);
	enabledRef.current = enabled;
	const listVisibleRef = React.useRef(listVisible);
	listVisibleRef.current = listVisible;
	const currentRevisionIdRef = React.useRef(currentRevisionId);
	currentRevisionIdRef.current = currentRevisionId;
	const draftRevisionIdRef = React.useRef(draftRevisionId ?? null);
	draftRevisionIdRef.current = draftRevisionId ?? null;
	const showChangesRef = React.useRef(showChanges);
	showChangesRef.current = showChanges;
	const onEnterRef = React.useRef(onEnter);
	onEnterRef.current = onEnter;
	const onFocusFallbackRef = React.useRef(onFocusFallback);
	onFocusFallbackRef.current = onFocusFallback;

	const sheetRef = React.useRef<RevisionViewSheet | null>(null);
	const barTitleRef = React.useRef<HTMLHeadingElement | null>(null);
	const dockRef = React.useRef<HTMLDivElement | null>(null);
	const openerRef = React.useRef<HTMLElement | null>(null);
	const savedScrollRef = React.useRef(0);
	const pendingScrollRef = React.useRef<PendingScroll>(null);
	const pendingFocusRef = React.useRef<PendingFocus>(null);
	const pendingAnnounceRef = React.useRef(false);
	const pendingStepRef = React.useRef(false);
	const pendingChangeRef = React.useRef<string | null>(null);
	const viewedWasCurrentRef = React.useRef(false);
	const announceFrameRef = React.useRef(0);

	React.useEffect(() => () => cancelAnimationFrame(announceFrameRef.current), []);

	const announce = React.useCallback((message: string) => {
		cancelAnimationFrame(announceFrameRef.current);
		setAnnouncement("");
		announceFrameRef.current = requestAnimationFrame(() => setAnnouncement(message));
	}, []);

	const select = React.useCallback((revisionId: string) => {
		setViewingId(revisionId);
		viewedWasCurrentRef.current = revisionId === currentRevisionIdRef.current;
		pendingScrollRef.current = "top";
		pendingAnnounceRef.current = true;
	}, []);

	const view = React.useCallback<RevisionViewContextValue["view"]>(
		(revisionId, options) => {
			if (!enabledRef.current || restoreRef.current) return;
			const opener = options?.opener ?? null;
			if (opener) openerRef.current = opener;
			if (viewingIdRef.current === revisionId) return;
			if (viewingIdRef.current === null) {
				onEnterRef.current?.();
				savedScrollRef.current = canvasRef.current?.scrollTop ?? 0;
				if (!opener) {
					const active = document.activeElement;
					openerRef.current = active instanceof HTMLElement ? active : null;
				}
			}
			if (!listVisibleRef.current) {
				if (sheetRef.current?.isOpen) sheetRef.current.close();
				pendingFocusRef.current = "bar";
			}
			pendingStepRef.current = false;
			select(revisionId);
		},
		[canvasRef, select],
	);

	const leave = React.useCallback(
		(message: string) => {
			if (viewingIdRef.current === null) return;
			restoreRef.current = null;
			setRestorePending(false);
			setViewingId(null);
			pendingStepRef.current = false;
			pendingChangeRef.current = null;
			pendingScrollRef.current = "saved";
			pendingFocusRef.current = "opener";
			announce(message);
		},
		[announce],
	);

	const exit = React.useCallback(() => leave(t`Back to editing.`), [leave, t]);

	const step = React.useCallback(
		(direction: RevisionStepDirection) => {
			const current = listRef.current;
			const id = viewingIdRef.current;
			if (!current || !id || restoreRef.current) return;
			const from = current.items.findIndex((item) => item.id === id);
			if (from < 0) return;
			const to = direction === "older" ? from + 1 : from - 1;
			if (to < 0) return;
			if (to >= visibleRevisionCount(current)) {
				if (
					current.items.length < current.total &&
					listLimitRef.current < REVISION_LIST_LIMIT_ALL
				) {
					pendingStepRef.current = true;
					setListLimit(REVISION_LIST_LIMIT_ALL);
				}
				return;
			}
			const next = current.items[to];
			if (next) select(next.id);
		},
		[select],
	);

	const setShowChanges = React.useCallback((next: boolean) => setShowChangesState(next), []);

	const goToChange = React.useCallback((targetId: string) => {
		if (viewingIdRef.current === null) return;
		if (!showChangesRef.current) setShowChangesState(true);
		if (sheetRef.current?.isOpen) sheetRef.current.close();
		pendingChangeRef.current = targetId;
		setChangeRequest((request) => request + 1);
	}, []);

	const showOlderVersions = React.useCallback(() => setListLimit(REVISION_LIST_LIMIT_ALL), []);

	const beginRestore = React.useCallback((restoredItem: Pick<ContentItem, "draftRevisionId">) => {
		restoreRef.current = {
			fromDraftId: draftRevisionIdRef.current,
			toDraftId: restoredItem.draftRevisionId ?? null,
		};
		setRestorePending(true);
	}, []);

	const cancelRestore = React.useCallback(() => {
		restoreRef.current = null;
		setRestorePending(false);
	}, []);

	const isRestoreArrival = React.useCallback(
		(draft: string | null | undefined, itemReset: boolean) => {
			const restore = restoreRef.current;
			if (!restore) return false;
			if (restore.toDraftId === restore.fromDraftId) return itemReset;
			return (draft ?? null) !== restore.fromDraftId;
		},
		[],
	);

	const completeRestore = React.useCallback(() => {
		restoreRef.current = null;
		setRestorePending(false);
		if (viewingIdRef.current === null) return;
		setViewingId(null);
		pendingStepRef.current = false;
		pendingChangeRef.current = null;
		pendingScrollRef.current = "top";
		pendingFocusRef.current = "afterRestore";
	}, []);

	const returnFocus = React.useCallback(() => {
		const opener = openerRef.current;
		if (opener && isShown(opener)) opener.focus();
		else onFocusFallbackRef.current?.();
	}, []);

	const hasRevision = revision !== null;
	React.useLayoutEffect(() => {
		const canvas = canvasRef.current;
		const scroll = pendingScrollRef.current;
		if (scroll && canvas) {
			pendingScrollRef.current = null;
			canvas.scrollTop = scroll === "top" ? 0 : savedScrollRef.current;
		}
		const focus = pendingFocusRef.current;
		if (focus === "bar") {
			if (barTitleRef.current) {
				pendingFocusRef.current = null;
				barTitleRef.current.focus({ preventScroll: true });
			}
		} else if (focus === "opener") {
			pendingFocusRef.current = null;
			if (focusIsLost(canvas)) returnFocus();
		} else if (focus === "afterRestore") {
			pendingFocusRef.current = null;
			// The restore dialog hands focus back to its trigger as it closes, after this commit.
			requestAnimationFrame(() => {
				if (focusIsLost(canvasRef.current)) returnFocus();
			});
		}
	}, [viewingId, hasRevision, canvasRef, returnFocus]);

	React.useEffect(() => {
		if (!pendingAnnounceRef.current || !revision) return;
		pendingAnnounceRef.current = false;
		const name = isolate(format.author(revision.author));
		announce(t`Viewing the version from ${when} by ${name}.`);
	}, [revision, when, format, announce, t]);

	React.useEffect(() => {
		if (!pendingStepRef.current || !list || query.isPlaceholderData) return;
		pendingStepRef.current = false;
		step("older");
	}, [list, query.isPlaceholderData, step]);

	React.useEffect(() => {
		if (!isViewing || !list || query.isPlaceholderData || restorePending) return;
		const followed =
			viewedWasCurrentRef.current && currentRevisionId && currentRevisionId !== viewingId
				? list.items.find((item) => item.id === currentRevisionId)
				: undefined;
		if (followed) {
			setViewingId(followed.id);
			pendingAnnounceRef.current = true;
			return;
		}
		if (index >= 0) {
			// Newer versions pushed it to the end of a partial list, past the one it compares with.
			if (index >= visibleCount && canLoadOlder) setListLimit(REVISION_LIST_LIMIT_ALL);
			return;
		}
		if (canLoadOlder) {
			setListLimit(REVISION_LIST_LIMIT_ALL);
			return;
		}
		leave(t`That version is no longer available. Back to editing.`);
	}, [
		isViewing,
		list,
		query.isPlaceholderData,
		restorePending,
		viewingId,
		index,
		visibleCount,
		canLoadOlder,
		currentRevisionId,
		leave,
		t,
	]);

	const listFailed = isViewing && query.isError && !list;
	React.useEffect(() => {
		if (!listFailed) return;
		leave(t`Couldn't load this version. Back to editing.`);
		// The shorter list may still be cached, which beats an error in the sidebar.
		setListLimit(REVISION_LIST_LIMIT);
	}, [listFailed, leave, t]);

	React.useEffect(() => {
		const targetId = pendingChangeRef.current;
		const canvas = canvasRef.current;
		if (!targetId || !canvas) return;
		pendingChangeRef.current = null;
		const target = canvas.querySelector<HTMLElement>(
			`#${CSS.escape(revisionTargetElementId(targetId))}`,
		);
		if (!target) return;
		const canvasBox = canvas.getBoundingClientRect();
		const targetBox = target.getBoundingClientRect();
		const available = canvas.clientHeight - (dockRef.current?.offsetHeight ?? 0);
		const offset =
			targetBox.height + CHANGE_TOP_MARGIN_PX * 2 > available
				? CHANGE_TOP_MARGIN_PX
				: (available - targetBox.height) / 2;
		canvas.scrollTo({
			top: Math.max(0, canvas.scrollTop + targetBox.top - canvasBox.top - offset),
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
		restartPulse(target);
		target.focus({ preventScroll: true });
	}, [changeRequest, canvasRef]);

	React.useEffect(() => {
		if (!isViewing) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
			if (sheetRef.current?.isOpen) return;
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest(
					'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"][aria-expanded="true"]',
				)
			) {
				return;
			}
			event.preventDefault();
			exit();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isViewing, exit]);

	const context = React.useMemo<RevisionViewContextValue>(
		() => ({
			viewingId: isViewing ? viewingId : null,
			viewingDiff: diff,
			currentRevisionId,
			liveRevisionId: liveRevisionId ?? null,
			listLimit,
			showOlderVersions,
			view,
			exit,
			goToChange,
		}),
		[
			isViewing,
			viewingId,
			diff,
			currentRevisionId,
			liveRevisionId,
			listLimit,
			showOlderVersions,
			view,
			exit,
			goToChange,
		],
	);

	return {
		viewingId: isViewing ? viewingId : null,
		revision,
		diff,
		diffFailed,
		authorColor,
		label: revision ? t`Version from ${when}` : "",
		isCurrent: revision !== null && revision.id === currentRevisionId,
		isPublished: revision !== null && revision.id === liveRevisionId,
		hasOlder,
		hasNewer,
		showChanges,
		setShowChanges,
		restorePending,
		announcement,
		view,
		exit,
		step,
		goToChange,
		beginRestore,
		cancelRestore,
		isRestoreArrival,
		completeRestore,
		context,
		sheetRef,
		barTitleRef,
		dockRef,
	};
}
