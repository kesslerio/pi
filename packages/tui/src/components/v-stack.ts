import {
	DOCUMENT_CHILD_WIDTH,
	recordInputViewport,
	renderInputChild,
	renderWithInputContext,
} from "../input-context.ts";
import { allocateStackSizes, Stack, type StackChild, type StackOptions, visibleStackEntries } from "./stack.ts";

export class VStack extends Stack {
	protected readonly layoutType = "vstack" as const;

	constructor(children: StackChild[] = [], options: StackOptions = {}) {
		super(children, options);
	}

	override [DOCUMENT_CHILD_WIDTH](width: number): number | undefined {
		return this.render === VStack.prototype.render ? Math.max(1, width) : undefined;
	}

	override render(width: number): string[] {
		return renderWithInputContext(this, width, () => this.renderContent(width)).lines;
	}

	private renderContent(width: number): string[] {
		const viewport = { width: Math.max(1, width), height: Number.MAX_SAFE_INTEGER };
		recordInputViewport(viewport);
		const entries = visibleStackEntries(this.entries, viewport);
		const rendered = entries.map((entry) => renderInputChild(entry.component, viewport.width, entry));
		const sizes = allocateStackSizes(
			entries,
			rendered.map((lines) => lines.length),
			undefined,
			this.gap,
		);
		const lines: string[] = [];
		for (let index = 0; index < entries.length; index++) {
			if (index > 0) {
				for (let gap = 0; gap < this.gap; gap++) lines.push("");
			}
			const childLines = rendered[index]!.slice(0, sizes[index]);
			lines.push(...childLines);
			for (let padding = childLines.length; padding < sizes[index]!; padding++) lines.push("");
		}
		return lines;
	}
}

export type { StackChild, StackEntry, StackEntryOptions, StackOptions } from "./stack.ts";
