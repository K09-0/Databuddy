import dayjs from "dayjs";

export function formatCompactNumber(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) {
		return "0";
	}
	return Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

export function formatDateLabel(
	dateStr: string,
	granularity: "hourly" | "daily"
): string {
	const date = dayjs(dateStr);
	if (granularity === "hourly") {
		return date.format("MMM D HH:mm");
	}
	return date.format("MMM D");
}

export function generateDateRange(
	startDate: string,
	endDate: string,
	granularity: "daily" | "hourly"
): string[] {
	const dates: string[] = [];
	let current = dayjs(startDate);
	const end = dayjs(endDate);
	const unit = granularity === "hourly" ? "hour" : "day";
	const fmt = granularity === "hourly" ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD";

	while (current.isBefore(end) || current.isSame(end, "day")) {
		dates.push(current.format(fmt));
		current = current.add(1, unit);
	}

	return dates;
}

export function normalizeDateKey(
	date: string,
	granularity: "hourly" | "daily"
): string {
	return granularity === "hourly" ? date : date.slice(0, 10);
}
