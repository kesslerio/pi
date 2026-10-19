import { DOCUMENT_CHILD_WIDTH, renderInputChild, renderWithInputContext } from "../input-context.ts";
import {
	type Component,
	dispatchMouseEvent,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "../tui.ts";

export type MouseRegionHandler = (event: TuiMouseEvent) => TuiMouseEventResult | undefined;

/** Adds mouse handling to an existing component without changing its rendering. */
export class MouseRegion implements Component {
	private readonly child: Component;
	private readonly onMouse: MouseRegionHandler;

	constructor(child: Component, onMouse: MouseRegionHandler) {
		this.child = child;
		this.onMouse = onMouse;
	}

	get children(): readonly Component[] {
		return [this.child];
	}

	render(width: number): string[] {
		return renderWithInputContext(this, width, () => renderInputChild(this.child, width)).lines;
	}

	[DOCUMENT_CHILD_WIDTH](width: number): number | undefined {
		return this.render === MouseRegion.prototype.render ? width : undefined;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | TuiMouseEventResult | undefined {
		const childResult = dispatchMouseEvent(this.child, event);
		return childResult ?? this.onMouse(event);
	}

	invalidate(): void {
		this.child.invalidate();
	}
}
