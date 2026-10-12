import { Toasty } from "@cloudflare/kumo";
import { i18n } from "@lingui/core";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import "../../../dist/styles.css";
import { RevisionViewBar } from "../../../src/components/revisions/RevisionViewBar";
import { render } from "../../utils/render.tsx";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Wednesday at 10:02 PM within the last week, so the bar reads "Wednesday, 10:02 PM". */
function lastWednesdayEvening(): string {
	const date = new Date();
	date.setHours(22, 2, 0, 0);
	while (date.getDay() !== 3 || Date.now() - date.getTime() < 2 * DAY_MS) {
		date.setDate(date.getDate() - 1);
	}
	return date.toISOString();
}

/** A date in an earlier year, which the bar spells out in full. */
function lastYearEvening(): string {
	const date = new Date(new Date().getFullYear() - 1, 8, 30, 22, 2);
	return date.toISOString();
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

function layoutOf(screen: Awaited<ReturnType<typeof renderBar>>, exitLabel: string) {
	const title = screen.getByRole("heading", { level: 2 }).element();
	const exit = screen.getByRole("button", { name: exitLabel, exact: true }).element();
	const restore = screen.getByRole("button", { name: "Restore", exact: true }).element();
	const card = title.closest("section")!;
	return {
		oneRow: exit.getBoundingClientRect().top < title.getBoundingClientRect().bottom,
		titleClipped: title.scrollWidth > title.clientWidth,
		actionsInside:
			restore.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5 &&
			card.scrollWidth <= card.clientWidth,
	};
}

describe("RevisionViewBar layout", () => {
	it("keeps one row with the full label when there is room", async () => {
		const screen = await renderBar(600);
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
		const screen = await renderBar(590, lastYearEvening());
		await expect.element(screen.getByRole("button", { name: "Done", exact: true })).toBeVisible();
		expect(layoutOf(screen, "Done")).toEqual({
			oneRow: true,
			titleClipped: false,
			actionsInside: true,
		});
	});
});
