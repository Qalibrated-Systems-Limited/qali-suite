"use client";

import { Component } from "react";

/**
 * Keeps a failure in the permissions editor inside its own card.
 *
 * Ticking a box once blanked the whole screen in production, and a blank page
 * says nothing about why. This shows the error itself, so it can be reported,
 * and a way back that does not lose the rest of the page.
 */
export default class EditorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Permissions editor failed:", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
        <p className="font-semibold text-red-700 dark:text-red-400">
          The permissions editor hit an error. Nothing was saved.
        </p>
        <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
          {String(error?.message || error)}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Reload the page
        </button>
      </div>
    );
  }
}
