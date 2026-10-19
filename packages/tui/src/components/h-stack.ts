import {
	DOCUMENT_CHILD_WIDTH,
	measureInputChild,
	recordInputViewport,
	renderInputChild,
	renderWithInputContext,
} from "../input-context.ts";
import type { StackLayoutEntry } from "../layout-node.ts";
import type { Component } from "../tui.ts";
import { compositeTuiLine } from "../tui.ts";
import { visibleWidth } from "../utils.ts";
import { allocateStackSizes, Stack, type StackChild, type StackOptions, visibleStackEntries } from "./stack.ts";

export class HStack extends Stack {
	protected readonly layoutType = "hstack" as const;

	constructor(children: StackChild[] = [], options: StackOptions = {}) {
		super(children, options);
	}

	override [DOCUMENT_CHILD_WIDTH](
		width: number,
		child?: Component,
		entries?: readonly StackLayoutEntry[],
		entry?: StackLayoutEntry,
	): number | undefined {
		if (this.render !== HStack.prototype.render) return undefined;
		if (child === this) return Math.max(1, width);
		if (!entries || entries.some((entry) => typeof entry.basis !== "number")) return undefined;
		const index = entry ? entries.indexOf(entry) : -1;
		return index < 0 ? undefined : allocateStackSizes(entries, [], Math.max(1, width), this.gap)[index];
	}

	override render(width: number): string[] {
		return renderWithInputContext(this, width, () => this.renderContent(width)).lines;
	}

	private renderContent(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const viewport = { width: safeWidth, height: Number.MAX_SAFE_INTEGER };
		recordInputViewport(viewport);
		const entries = visibleStackEntries(this.entries, viewport);
		if (entries.length === 0) return [];

		const intrinsicWidths = entries.map((entry) => {
			const lines = measureInputChild(entry.component, safeWidth);
			return lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
		});
		const widths = allocateStackSizes(entries, intrinsicWidths, safeWidth, this.gap);
		const rendered = entries.map((entry, index) =>
			widths[index] === 0 ? [] : renderInputChild(entry.component, widths[index]!, entry),
		);
		const height = rendered.reduce((max, lines) => Math.max(max, lines.length), 0);
		const result = Array.from({ length: height }, () => "");
		let x = 0;
		for (let index = 0; index < rendered.length; index++) {
			const lines = rendered[index]!;
			const childWidth = widths[index]!;
			let offset = 0;
			if (this.align === "center") offset = Math.floor((height - lines.length) / 2);
			else if (this.align === "end") offset = height - lines.length;
			for (let row = 0; row < lines.length; row++) {
				const target = row + offset;
				if (target < 0 || target >= result.length) continue;
				result[target] = compositeTuiLine(result[target]!, lines[row]!, x, childWidth, safeWidth);
			}
			x += childWidth + this.gap;
		}
		return result;
	}
}
