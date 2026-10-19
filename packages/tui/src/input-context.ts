import type { LayoutViewport, StackLayoutEntry } from "./layout-node.ts";
import type { Component } from "./tui.ts";

// Internal stock-owner width transform. Custom components have no new context obligation.
export const DOCUMENT_CHILD_WIDTH = Symbol("document-child-width");

export function documentChildWidth(
	component: Component,
	width: number,
	child: Component,
	entries?: readonly StackLayoutEntry[],
	entry?: StackLayoutEntry,
): number | undefined {
	return (
		component as Component & {
			[DOCUMENT_CHILD_WIDTH]?: (
				width: number,
				child: Component,
				entries?: readonly StackLayoutEntry[],
				entry?: StackLayoutEntry,
			) => number | undefined;
		}
	)[DOCUMENT_CHILD_WIDTH]?.(width, child, entries, entry);
}

/** One render occurrence, retained only by its current document/overlay/layout owner. */
export interface InputRenderContext {
	component: Component;
	entry?: StackLayoutEntry;
	width: number;
	viewport?: LayoutViewport;
	children: InputRenderContext[];
}

export interface InputRenderResult {
	lines: string[];
	context: InputRenderContext;
}

export interface InputMount {
	component: Component;
	width: number;
	viewport?: LayoutViewport;
	rendered?: InputRenderContext;
}

let current: InputRenderContext | undefined;

export function recordInputViewport(viewport: LayoutViewport): void {
	if (current) current.viewport = viewport;
}

export function renderWithInputContext(
	component: Component,
	width: number,
	render: () => string[] = () => component.render(width),
): InputRenderResult {
	// Stock owners also enter here when invoked directly by an opaque custom render method.
	if (current?.component === component && current.width === width) return { lines: render(), context: current };
	const parent = current;
	const context: InputRenderContext = { component, width, children: [] };
	parent?.children.push(context);
	current = context;
	try {
		return { lines: render(), context };
	} finally {
		current = parent;
	}
}

export function renderInputChild(component: Component, width: number, entry?: StackLayoutEntry): string[] {
	const rendered = renderWithInputContext(component, width);
	rendered.context.entry = entry;
	return rendered.lines;
}

export function measureInputChild(component: Component, width: number): string[] {
	const parent = current;
	current = undefined;
	try {
		return component.render(width);
	} finally {
		current = parent;
	}
}
