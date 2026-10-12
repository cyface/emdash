import { Button, Switch } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import * as React from "react";

import type { ContentItem, RevisionListItem } from "../../lib/api";
import { cn } from "../../lib/utils.js";
import { CaretNext, CaretPrev } from "../ArrowIcons.js";
import { revisionDate, useRevisionFormat, type AuthorColor } from "./revision-format.js";
import { RevisionRestoreDialog } from "./RevisionRestoreDialog.js";
import type { RevisionStepDirection } from "./useRevisionView.js";

/**
 * How the bar fits its width: one row with full labels, one row with the short "Done", or the
 * actions stacked under the version.
 */
export type RevisionBarLayout = "wide" | "compact" | "stacked";

/** The narrowest dock, in rem, that holds each one-row layout in English. */
const BAR_WIDTHS_REM = {
	plain: { wide: 36, compact: 32 },
	stepper: { wide: 41, compact: 37 },
} as const;

const LAYOUT_STEPS: Record<RevisionBarLayout, RevisionBarLayout> = {
	wide: "compact",
	compact: "stacked",
	stacked: "stacked",
};

export interface RevisionViewBarProps {
	collection: string;
	entryId: string;
	revision: RevisionListItem;
	authorColor: AuthorColor;
	isCurrent: boolean;
	isPublished: boolean;
	/** The version has an older one to compare with, so there are changes to show. */
	canShowChanges: boolean;
	showChanges: boolean;
	onShowChangesChange: (showChanges: boolean) => void;
	onExit: () => void;
	/** Adds older and newer arrows, for when the Revisions list isn't on screen. */
	showStepper: boolean;
	hasOlder: boolean;
	hasNewer: boolean;
	onStep: (direction: RevisionStepDirection) => void;
	readOnly: boolean;
	/** A save is in flight; restoring now could race it. */
	saveBusy: boolean;
	isDirty: boolean;
	restorePending: boolean;
	onRestoreStart: (restoredItem: ContentItem) => void;
	onRestoreFailed: () => void;
	onRestoreSettled: () => void;
	onRevisionRestored?: (item: ContentItem) => void | Promise<void>;
	titleRef: React.RefObject<HTMLHeadingElement | null>;
	dockRef: React.RefObject<HTMLDivElement | null>;
}

function useBarLayout(
	dockRef: React.RefObject<HTMLDivElement | null>,
	cardRef: React.RefObject<HTMLElement | null>,
	titleRef: React.RefObject<HTMLElement | null>,
	widths: { wide: number; compact: number },
	contentKey: string,
): RevisionBarLayout {
	const [layout, setLayout] = React.useState<RevisionBarLayout>("wide");
	React.useLayoutEffect(() => {
		const dock = dockRef.current;
		if (!dock) return;
		const measure = () => {
			const style = getComputedStyle(dock);
			const width =
				dock.clientWidth -
				parseFloat(style.paddingInlineStart) -
				parseFloat(style.paddingInlineEnd);
			const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
			setLayout(
				width >= widths.wide * rem ? "wide" : width >= widths.compact * rem ? "compact" : "stacked",
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(dock);
		return () => observer.disconnect();
	}, [dockRef, widths, contentKey]);
	// Longer translations can need more room than the English widths allow for.
	React.useLayoutEffect(() => {
		if (layout === "stacked") return;
		const card = cardRef.current;
		const title = titleRef.current;
		if (!card || !title) return;
		// Both widths are rounded, so text with fractional widths can look a pixel too wide.
		if (card.scrollWidth - card.clientWidth > 1 || title.scrollWidth - title.clientWidth > 1) {
			setLayout((current) => (current === layout ? LAYOUT_STEPS[layout] : current));
		}
	});
	return layout;
}

/** The bar at the bottom of the canvas while a saved version is shown in place of the editor. */
export function RevisionViewBar({
	collection,
	entryId,
	revision,
	authorColor,
	isCurrent,
	isPublished,
	canShowChanges,
	showChanges,
	onShowChangesChange,
	onExit,
	showStepper,
	hasOlder,
	hasNewer,
	onStep,
	readOnly,
	saveBusy,
	isDirty,
	restorePending,
	onRestoreStart,
	onRestoreFailed,
	onRestoreSettled,
	onRevisionRestored,
	titleRef,
	dockRef,
}: RevisionViewBarProps) {
	const { t } = useLingui();
	const format = useRevisionFormat();
	const titleId = React.useId();
	const [restoreOpen, setRestoreOpen] = React.useState(false);
	const cardRef = React.useRef<HTMLElement>(null);
	const statuses = [isCurrent && t`Current version`, isPublished && t`Published`].filter(
		(label): label is string => Boolean(label),
	);
	const canRestore = !isCurrent && !readOnly;
	const when = format.when(revisionDate(revision.createdAt));
	const layout = useBarLayout(
		dockRef,
		cardRef,
		titleRef,
		showStepper ? BAR_WIDTHS_REM.stepper : BAR_WIDTHS_REM.plain,
		[when, canShowChanges, canRestore].join("|"),
	);
	const stacked = layout === "stacked";
	const olderRef = React.useRef<HTMLButtonElement>(null);
	const newerRef = React.useRef<HTMLButtonElement>(null);
	const lastStepRef = React.useRef<RevisionStepDirection | null>(null);

	React.useLayoutEffect(() => {
		const direction = lastStepRef.current;
		if (!direction) return;
		lastStepRef.current = null;
		const arrow = direction === "older" ? olderRef.current : newerRef.current;
		const active = document.activeElement;
		if (arrow?.disabled && (active === arrow || active === document.body)) {
			titleRef.current?.focus({ preventScroll: true });
		}
	}, [revision.id, titleRef]);

	const step = (direction: RevisionStepDirection) => {
		lastStepRef.current = direction;
		onStep(direction);
	};

	const closeRestore = React.useCallback(() => setRestoreOpen(false), []);

	return (
		<div
			ref={dockRef}
			className="emdash-revision-dock pointer-events-none sticky bottom-0 z-20 -mx-(--emdash-editor-gutter) mt-2 flex justify-center px-(--emdash-editor-gutter) pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]"
		>
			<section
				ref={cardRef}
				aria-labelledby={titleId}
				data-author-color={authorColor}
				className={cn(
					"emdash-revision-bar pointer-events-auto flex max-w-full items-center rounded-[0.875rem] bg-kumo-base p-1.5 ring ring-kumo-line",
					stacked ? "w-full flex-wrap gap-1.5" : "gap-3 ps-4",
				)}
			>
				<div
					className={cn(
						"flex min-w-0 flex-1 items-center gap-1",
						stacked && "basis-full",
						stacked && !showStepper && "px-2.5",
					)}
				>
					{showStepper && (
						<Button
							ref={olderRef}
							type="button"
							variant="ghost"
							shape="square"
							aria-label={t`Older version`}
							icon={<CaretPrev className="size-4" />}
							disabled={!hasOlder}
							onClick={() => step("older")}
						/>
					)}
					<div className={cn("grid min-w-0", showStepper && "flex-1 justify-items-center")}>
						<h2
							ref={titleRef}
							id={titleId}
							tabIndex={-1}
							className="max-w-full truncate text-base font-semibold focus:outline-none"
						>
							{when}
						</h2>
						<p className="flex max-w-full min-w-0 items-center gap-1.5 text-xs leading-4 text-kumo-subtle">
							<span
								aria-hidden="true"
								className="size-2 shrink-0 rounded-full bg-(--emdash-author)"
							/>
							<bdi className="truncate">{format.author(revision.author)}</bdi>
							{statuses.map((label) => (
								<React.Fragment key={label}>
									<span aria-hidden="true">·</span>
									<span className="sr-only">, </span>
									<span className="shrink-0">{label}</span>
								</React.Fragment>
							))}
						</p>
					</div>
					{showStepper && (
						<Button
							ref={newerRef}
							type="button"
							variant="ghost"
							shape="square"
							aria-label={t`Newer version`}
							icon={<CaretNext className="size-4" />}
							disabled={!hasNewer}
							onClick={() => step("newer")}
						/>
					)}
				</div>
				<div
					className={cn("flex shrink-0 items-center gap-1.5", stacked && "basis-full justify-end")}
				>
					{canShowChanges && (
						<div className={cn("ps-1.5 pe-2", stacked && "me-auto")}>
							<Switch
								size="sm"
								label={t`Show changes`}
								checked={showChanges}
								onCheckedChange={onShowChangesChange}
							/>
						</div>
					)}
					<Button type="button" variant="secondary" onClick={onExit}>
						{layout === "wide" ? t`Back to editing` : t`Done`}
					</Button>
					{canRestore && (
						<Button
							type="button"
							variant="primary"
							icon={<ArrowCounterClockwise />}
							disabled={saveBusy || restorePending}
							onClick={() => setRestoreOpen(true)}
						>
							{t`Restore`}
						</Button>
					)}
				</div>
			</section>
			<RevisionRestoreDialog
				open={restoreOpen}
				onClose={closeRestore}
				collection={collection}
				entryId={entryId}
				revision={revision}
				isDirty={isDirty}
				restorePending={restorePending}
				onRestoreStart={onRestoreStart}
				onRestoreFailed={onRestoreFailed}
				onRestoreSettled={onRestoreSettled}
				onRevisionRestored={onRevisionRestored}
			/>
		</div>
	);
}
