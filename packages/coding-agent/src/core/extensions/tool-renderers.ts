import type { ToolRenderers } from "./types.ts";

/** Whether a definition selects renderer composition instead of the absent-definition formatter. */
export function hasToolRendererDefinition(definition: ToolRenderers | undefined): boolean {
	return (
		definition !== undefined &&
		(definition.isVisible === undefined ||
			definition.renderShell !== undefined ||
			definition.renderCall !== undefined ||
			definition.renderResult !== undefined ||
			"name" in definition)
	);
}
