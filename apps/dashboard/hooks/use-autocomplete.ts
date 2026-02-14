import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";

export interface AutocompleteData {
	customEvents: string[];
	pagePaths: string[];
	browsers: string[];
	operatingSystems: string[];
	countries: string[];
	deviceTypes: string[];
	utmSources: string[];
	utmMediums: string[];
	utmCampaigns: string[];
}

export function useAutocompleteData(websiteId: string, enabled = true) {
	return useQuery({
		...orpc.autocomplete.get.queryOptions({
			input: { websiteId },
		}),
		enabled: enabled && !!websiteId,
		staleTime: 1000 * 60 * 5,
	});
}
