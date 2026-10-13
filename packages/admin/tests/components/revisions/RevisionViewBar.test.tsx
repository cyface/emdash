import { Toasty } from "@cloudflare/kumo";
import { i18n } from "@lingui/core";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../dist/styles.css";
import { RevisionViewBar } from "../../../src/components/revisions/RevisionViewBar";
import { render } from "../../utils/render.tsx";

/** A Saturday, so the Wednesday before it reads as "Wednesday", the longest English weekday. */
const NOW = new Date(2026, 9, 17, 12);

function lastWednesdayEvening(): string {
	return new Date(2026, 9, 14, 22, 2).toISOString();
}

/** A date in an earlier year, which the bar spells out in full. */
function lastYearEvening(): string {
	return new Date(2025, 8, 30, 22, 2).toISOString();
}

function BarAt({ width, createdAt }: { width: number; createdAt: string }) {
	const titleRef = React.useRef<HTMLHeadingElement>(null);
	const dockRef = React.useRef<HTMLDivElement>(null);
	return (
		<div style={{ width, ["--emdash-editor-gutter" as string]: "0px" }}>
			<RevisionViewBar
				collection="posts"
				entryId="post_1"
				revision={{
					id: "rev-1",
					collection: "posts",
					entryId: "post_1",
					data: {},
					authorId: "user-maya",
					author: { id: "user-maya", name: "Maya Chen" },
					createdAt,
				}}
				authorColor="blue"
				isCurrent={false}
				isPublished={false}
				canShowChanges
				showChanges
				onShowChangesChange={vi.fn()}
				onExit={vi.fn()}
				showStepper={false}
				hasOlder
				hasNewer
				onStep={vi.fn()}
				readOnly={false}
				saveBusy={false}
				isDirty={false}
				restorePending={false}
				onRestoreStart={vi.fn()}
				onRestoreFailed={vi.fn()}
				onRestoreSettled={vi.fn()}
				titleRef={titleRef}
				dockRef={dockRef}
			/>
		</div>
	);
}

function renderBar(width: number, createdAt = lastWednesdayEvening()) {
	return render(<BarAt width={width} createdAt={createdAt} />, { wrapper: Toasty });
}

type BarScreen = Awaited<ReturnType<typeof renderBar>>;

/** The dock width the bar starts showing the full label at, without arrows. */
const WIDE_DOCK_PX = 36 * 16;

/** The width the card takes on one row with the full label, in the fonts this browser has. */
async function fullLabelWidth(screen: BarScreen, createdAt: string): Promise<number> {
	await screen.rerender(<BarAt width={2000} createdAt={createdAt} />);
	await expect.element(screen.getByRole("button", { name: "Back to editing" })).toBeVisible();
	const card = screen.getByRole("heading", { level: 2 }).element().closest("section")!;
	return card.getBoundingClientRect().width;
}

function layoutOf(screen: BarScreen, exitLabel: string) {
	const title = screen.getByRole("heading", { level: 2 }).element();
	const exit = screen.getByRole("button", { name: exitLabel, exact: true }).element();
	const restore = screen.getByRole("button", { name: "Restore", exact: true }).element();
	const card = title.closest("section")!;
	const text = document.createRange();
	text.selectNodeContents(title);
	return {
		oneRow: exit.getBoundingClientRect().top < title.getBoundingClientRect().bottom,
		titleClipped: text.getBoundingClientRect().width > title.getBoundingClientRect().width,
		actionsInside:
			restore.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5 &&
			card.scrollWidth <= card.clientWidth,
	};
}

describe("RevisionViewBar layout", () => {
	beforeEach(() => {
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps one row with the full label when there is just room for it", async () => {
		const createdAt = lastWednesdayEvening();
		const screen = await renderBar(2000, createdAt);
		const width = Math.max(Math.ceil(await fullLabelWidth(screen, createdAt)), WIDE_DOCK_PX);
		await screen.rerender(<BarAt width={width} createdAt={createdAt} />);
		await expect.element(screen.getByRole("button", { name: "Back to editing" })).toBeVisible();
		expect(layoutOf(screen, "Back to editing")).toEqual({
			oneRow: true,
			titleClipped: false,
			actionsInside: true,
		});
	});

	it("stays on one row with the short label at a laptop width with the sidebar open", async () => {
		const screen = await renderBar(546);
		await expect.element(screen.getByRole("button", { name: "Done", exact: true })).toBeVisible();
		expect(screen.getByRole("button", { name: "Back to editing" }).query()).toBeNull();
		expect(layoutOf(screen, "Done")).toEqual({
			oneRow: true,
			titleClipped: false,
			actionsInside: true,
		});
	});

	it("stacks the actions under the version when one row can't hold them", async () => {
		const screen = await renderBar(420);
		await expect.element(screen.getByRole("button", { name: "Done", exact: true })).toBeVisible();
		expect(layoutOf(screen, "Done")).toEqual({
			oneRow: false,
			titleClipped: false,
			actionsInside: true,
		});
	});

	it("settles on stacking when even the short label can't fit a longer version label", async () => {
		const screen = await renderBar(520, lastYearEvening());
		await expect.element(screen.getByRole("button", { name: "Done", exact: true })).toBeVisible();
		const layouts = new Set<boolean>();
		for (let frame = 0; frame < 10; frame++) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			layouts.add(layoutOf(screen, "Done").oneRow);
		}
		expect([...layouts]).toEqual([false]);
		expect(layoutOf(screen, "Done")).toEqual({
			oneRow: false,
			titleClipped: false,
			actionsInside: true,
		});
	});

	it("keeps the full label in Arabic, where the card rounds a pixel wider than its box", async () => {
		const previousLocale = i18n.locale;
		i18n.load("ar", {});
		i18n.activate("ar");
		document.documentElement.dir = "rtl";
		try {
			const screen = await renderBar(800);
			const card = screen.getByRole("heading", { level: 2 }).element().closest("section")!;
			expect(card.scrollWidth - card.clientWidth).toBe(1);
			await expect.element(screen.getByRole("button", { name: "Back to editing" })).toBeVisible();
		} finally {
			document.documentElement.dir = "ltr";
			i18n.activate(previousLocale);
		}
	});

	it("gives up the full label when a longer version label needs the room", async () => {
		const createdAt = lastYearEvening();
		const screen = await renderBar(2000, createdAt);
		const width = Math.ceil(await fullLabelWidth(screen, createdAt)) - 1;
		expect(width).toBeGreaterThanOrEqual(WIDE_DOCK_PX);
		await screen.rerender(<BarAt width={width} createdAt={createdAt} />);
		await expect.element(screen.getByRole("button", { name: "Done", exact: true })).toBeVisible();
		expect(layoutOf(screen, "Done")).toEqual({
			oneRow: true,
			titleClipped: false,
			actionsInside: true,
		});
	});
});
