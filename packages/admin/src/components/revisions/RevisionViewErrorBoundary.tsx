import { Banner } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import * as React from "react";

export function RevisionViewError() {
	const { t } = useLingui();
	return <Banner variant="error" role="alert" title={t`This version can't be shown.`} />;
}

interface RevisionViewErrorBoundaryState {
	hasError: boolean;
}

/** Keeps a version that fails to render from taking the editor down with it. */
export class RevisionViewErrorBoundary extends React.Component<
	{ children: React.ReactNode },
	RevisionViewErrorBoundaryState
> {
	override state: RevisionViewErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(): RevisionViewErrorBoundaryState {
		return { hasError: true };
	}

	override componentDidCatch(error: unknown) {
		console.error("[revisions] Failed to show version:", error);
	}

	override render() {
		return this.state.hasError ? <RevisionViewError /> : this.props.children;
	}
}
