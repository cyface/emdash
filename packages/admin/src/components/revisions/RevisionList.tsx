import { Button } from "@cloudflare/kumo";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import * as React from "react";

import type { RevisionListItem, RevisionListResponse } from "../../lib/api";
import type { ChangeItem } from "../../lib/revision-diff/types.js";
import { cn } from "../../lib/utils.js";
import { changeLabel } from "./change-labels.js";
import {
	localDayKey,
	revisionAuthorColor,
	revisionAuthorColors,
	revisionDate,
	useRevisionFormat,
	type AuthorColor,
} from "./revision-format.js";
import { REVISION_LIST_LIMIT_ALL, visibleRevisionCount } from "./revision-query.js";
import { useRevisionViewContext, type RevisionViewContextValue } from "./revision-view-context.js";

const VISIBLE_CHANGES = 5;

const ROW_CLASS = "grid w-full gap-0.5 rounded-lg px-2.5 py-2 text-start";

interface DayGroup {
	key: string;
	/** Unique even when the list isn't strictly in date order and a day comes up twice. */
	id: string;
	label: string;
	items: RevisionListItem[];
}

interface RevisionListProps {
	list: RevisionListResponse;
	/** The list is waiting for older versions and still shows the shorter one. */
	loadingOlder: boolean;
}

/** Versions grouped by day, with what changed under the one shown in the canvas. */
export function RevisionList({ list, loadingOlder }: RevisionListProps) {
	const { t } = useLingui();
	const view = useRevisionViewContext();
	const format = useRevisionFormat();
	const headingIdPrefix = React.useId();
	const rootRef = React.useRef<HTMLDivElement>(null);
	const focusRowAfterLoad = React.useRef<number | null>(null);

	const visibleCount = visibleRevisionCount(list);
	const colors = React.useMemo(() => revisionAuthorColors(list.items), [list.items]);

	const groups: DayGroup[] = [];
	const dayCounts = new Map<string, number>();
	for (const item of list.items.slice(0, visibleCount)) {
		const date = revisionDate(item.createdAt);
		const key = localDayKey(date);
		const group = groups.at(-1);
		if (group?.key === key) {
			group.items.push(item);
			continue;
		}
		const count = dayCounts.get(key) ?? 0;
		dayCounts.set(key, count + 1);
		groups.push({
			key,
			id: count ? `${key}:${count}` : key,
			label: format.day(date),
			items: [item],
		});
	}

	React.useEffect(() => {
		const index = focusRowAfterLoad.current;
		if (index === null || loadingOlder) return;
		focusRowAfterLoad.current = null;
		const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-revision-row]") ?? [])];
		(rows[index] ?? rows.at(-1))?.focus();
	}, [loadingOlder, visibleCount]);

	const canShowOlder =
		view !== null &&
		list.total > visibleCount &&
		(view.listLimit !== REVISION_LIST_LIMIT_ALL || loadingOlder);

	return (
		<div ref={rootRef} className="pt-2">
			{groups.map((group) => {
				const headingId = `${headingIdPrefix}-${group.id}`;
				return (
					<React.Fragment key={group.id}>
						<h4
							id={headingId}
							className="px-2.5 pt-3.5 pb-1 text-xs leading-4 font-medium text-kumo-subtle first:pt-0"
						>
							{group.label}
						</h4>
						<ul aria-labelledby={headingId} className="grid grid-cols-1 gap-0.5">
							{group.items.map((item) => (
								<VersionRow
									key={item.id}
									item={item}
									list={list}
									view={view}
									color={revisionAuthorColor(colors, item)}
								/>
							))}
						</ul>
					</React.Fragment>
				);
			})}
			{canShowOlder && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="ms-0.5 mt-2"
					loading={loadingOlder}
					onClick={() => {
						focusRowAfterLoad.current = visibleCount;
						view.showOlderVersions();
					}}
				>
					{t`Show older versions`}
				</Button>
			)}
		</div>
	);
}

interface VersionRowProps {
	item: RevisionListItem;
	list: RevisionListResponse;
	view: RevisionViewContextValue | null;
	color: AuthorColor;
}

function VersionRow({ item, list, view, color }: VersionRowProps) {
	const { t } = useLingui();
	const format = useRevisionFormat();
	const date = revisionDate(item.createdAt);
	const when = format.when(date);
	const author = format.author(item.author);
	const isCurrent = view?.currentRevisionId === item.id;
	const isPublished = view?.liveRevisionId === item.id;
	const isSelected = view?.viewingId === item.id;

	const label =
		isCurrent && isPublished
			? t`${when}, Current version, Published, ${author}`
			: isCurrent
				? t`${when}, Current version, ${author}`
				: isPublished
					? t`${when}, Published, ${author}`
					: t`${when}, ${author}`;

	const content = (
		<>
			<span className="sr-only">{label}</span>
			<span aria-hidden="true" className="flex min-w-0 items-baseline gap-2">
				<time dateTime={date.toISOString()} className="shrink-0 text-base font-medium tabular-nums">
					<bdi>{format.time(date)}</bdi>
				</time>
				{(isCurrent || isPublished) && (
					<span className="truncate text-xs leading-4 text-kumo-subtle">
						{isCurrent && t`Current version`}
						{isCurrent && isPublished && " · "}
						{isPublished && <span className="text-kumo-success">{t`Published`}</span>}
					</span>
				)}
			</span>
			<span
				aria-hidden="true"
				className="flex min-w-0 items-center gap-2 text-base text-kumo-subtle"
			>
				<span
					data-author-color={color}
					className="size-2 shrink-0 rounded-full bg-(--emdash-author)"
				/>
				<bdi className="truncate">{author}</bdi>
			</span>
		</>
	);

	return (
		<li className={cn("rounded-lg", isSelected && "bg-kumo-tint")}>
			{view ? (
				<button
					type="button"
					data-revision-row=""
					aria-current={isSelected || undefined}
					onClick={(event) => {
						if (!isSelected) view.view(item.id, { opener: event.currentTarget });
					}}
					className={cn(
						ROW_CLASS,
						"outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:ring-inset",
						!isSelected && "cursor-pointer hover:bg-kumo-tint/60",
					)}
				>
					{content}
				</button>
			) : (
				<div className={ROW_CLASS}>{content}</div>
			)}
			{view && isSelected && view.viewingDiff && view.viewingDiff.changes.length > 0 && (
				<ChangeList changes={view.viewingDiff.changes} list={list} goToChange={view.goToChange} />
			)}
		</li>
	);
}

interface ChangeListProps {
	changes: readonly ChangeItem[];
	list: RevisionListResponse;
	goToChange: (targetId: string) => void;
}

function ChangeList({ changes, list, goToChange }: ChangeListProps) {
	const { t, i18n } = useLingui();
	const format = useRevisionFormat();
	const [showAll, setShowAll] = React.useState(false);
	const firstRevealed = React.useRef<HTMLElement | null>(null);
	const focusRevealed = React.useRef(false);

	React.useEffect(() => {
		if (!showAll || !focusRevealed.current) return;
		focusRevealed.current = false;
		firstRevealed.current?.focus();
	}, [showAll]);

	const restoredWhen = (revisionId: string) => {
		const source = list.items.find((item) => item.id === revisionId);
		return source ? format.when(revisionDate(source.createdAt)) : null;
	};
	const shown = showAll ? changes : changes.slice(0, VISIBLE_CHANGES);
	const hiddenCount = changes.length - shown.length;

	return (
		<ul
			aria-label={t`Changes in this version`}
			className="mb-2 ms-3.5 me-2 grid grid-cols-1 border-s-[1.5px] border-kumo-line ps-1.5"
		>
			{shown.map((change, index) => {
				const text = changeLabel(i18n, change, { restoredWhen });
				const ref =
					index === VISIBLE_CHANGES
						? (element: HTMLElement | null) => {
								firstRevealed.current = element;
							}
						: undefined;
				const target = "target" in change ? change.target : null;
				return target ? (
					<li key={index}>
						<button
							ref={ref}
							type="button"
							onClick={() => goToChange(target)}
							className="block w-full cursor-pointer truncate rounded-md px-2 py-1 text-start text-base outline-none hover:bg-kumo-base focus-visible:ring-2 focus-visible:ring-kumo-brand pointer-coarse:py-2"
						>
							{text}
						</button>
					</li>
				) : (
					<li
						key={index}
						ref={ref}
						tabIndex={ref ? -1 : undefined}
						className="truncate rounded-md px-2 py-1 text-base text-kumo-subtle outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
					>
						{text}
					</li>
				);
			})}
			{hiddenCount > 0 && (
				<li className="mt-0.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							focusRevealed.current = true;
							setShowAll(true);
						}}
					>
						{plural(hiddenCount, { one: "Show # more", other: "Show # more" })}
					</Button>
				</li>
			)}
		</ul>
	);
}
