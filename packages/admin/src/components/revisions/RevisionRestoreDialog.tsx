import { Toast } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { restoreRevision, type ContentItem, type RevisionListItem } from "../../lib/api";
import { isolate } from "../../lib/utils.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { getMutationError } from "../DialogError.js";
import { revisionDate, useRevisionFormat } from "./revision-format.js";

export interface RevisionRestoreDialogProps {
	open: boolean;
	onClose: () => void;
	collection: string;
	entryId: string;
	revision: RevisionListItem;
	/** The editor holds edits that restoring would replace. */
	isDirty: boolean;
	/** The server restored the version and the editor is loading it. */
	restorePending: boolean;
	onRestoreStart: (restoredItem: ContentItem) => void;
	onRestoreFailed: () => void;
	/** Closes the view when nothing reloads the editor. */
	onRestoreSettled: () => void;
	/** Reloads the editor with the restored draft. */
	onRevisionRestored?: (item: ContentItem) => void | Promise<void>;
}

export function RevisionRestoreDialog({
	open,
	onClose,
	collection,
	entryId,
	revision,
	isDirty,
	restorePending,
	onRestoreStart,
	onRestoreFailed,
	onRestoreSettled,
	onRevisionRestored,
}: RevisionRestoreDialogProps) {
	const { t } = useLingui();
	const format = useRevisionFormat();
	const queryClient = useQueryClient();
	const toastManager = Toast.useToastManager();
	const when = isolate(format.when(revisionDate(revision.createdAt)));
	const shownRef = React.useRef(false);
	React.useEffect(() => {
		shownRef.current = open;
		return () => {
			shownRef.current = false;
		};
	}, [open]);

	const restore = useMutation({
		mutationFn: (revisionId: string) => restoreRevision(revisionId),
		onSuccess: async (restoredItem) => {
			onRestoreStart(restoredItem);
			if (onRevisionRestored) {
				try {
					await onRevisionRestored(restoredItem);
				} catch (error) {
					onRestoreFailed();
					throw error;
				}
			} else {
				void queryClient.invalidateQueries({ queryKey: ["content", collection, entryId] });
				void queryClient.invalidateQueries({ queryKey: ["revisions", collection, entryId] });
				onRestoreSettled();
			}
			onClose();
			toastManager.add({
				title: t`Version restored`,
				description: t`The version from ${when} is now your draft. Publish when you're ready.`,
				type: "success",
			});
		},
		onError: (error) => {
			// The dialog shows the error itself while it is open.
			if (shownRef.current) return;
			toastManager.add({
				title: t`Restore failed`,
				description: getMutationError(error) ?? undefined,
				type: "error",
			});
		},
	});

	const resetRestore = restore.reset;
	React.useEffect(() => {
		if (open) resetRestore();
	}, [open, resetRestore]);

	return (
		<ConfirmDialog
			open={open}
			onClose={onClose}
			compact
			variant="primary"
			title={t`Restore this version?`}
			description={
				isDirty
					? t`The version from ${when} becomes your draft. Nothing changes on the live site until you publish, and the current version stays in the list. Your unsaved changes will be lost.`
					: t`The version from ${when} becomes your draft. Nothing changes on the live site until you publish, and the current version stays in the list.`
			}
			confirmLabel={t`Restore`}
			pendingLabel={t`Restoring…`}
			isPending={restore.isPending || restorePending}
			preventCloseWhilePending
			error={restore.error}
			onConfirm={() => restore.mutate(revision.id)}
		/>
	);
}
