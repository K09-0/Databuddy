import type { AppContext } from "../../config/context";

export function getAppContext(options: {
	experimental_context?: unknown;
}): AppContext {
	const ctx = options.experimental_context;
	if (!ctx || typeof ctx !== "object") {
		throw new Error(
			"Tool requires app context. Ensure experimental_context is passed to the agent."
		);
	}
	return ctx as AppContext;
}
