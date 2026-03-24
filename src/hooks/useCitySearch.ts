import { useReducer, useEffect, useRef } from "react";
import { searchCitiesStatic } from "@/lib/data/city-zip-lookup";
import { parseQuery, CityResult } from "@/lib/city-search";

type SearchState = "idle" | "loading" | "done" | "error";

type State = {
  results: CityResult[];
  status: SearchState;
};

type Action =
  | { type: "SET_RESULTS"; results: CityResult[]; status: SearchState }
  | { type: "SET_STATUS"; status: SearchState };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_RESULTS":
      return { results: action.results, status: action.status };
    case "SET_STATUS":
      return { ...state, status: action.status };
    default:
      return state;
  }
}

export function useCitySearch(query: string) {
  const [{ results, status }, dispatch] = useReducer(reducer, {
    results: [],
    status: "idle",
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();

    // 5-digit zip — don't run city search
    if (/^\d{5}$/.test(q)) {
      dispatch({ type: "SET_RESULTS", results: [], status: "idle" });
      return;
    }

    if (q.length < 2) {
      dispatch({ type: "SET_RESULTS", results: [], status: "idle" });
      return;
    }

    // Tier 1 — instant static lookup
    const staticHits = searchCitiesStatic(q).map(c => ({
      display: c.display,
      zip: c.zip,
      source: "static" as const,
    }));

    if (staticHits.length > 0) {
      dispatch({ type: "SET_RESULTS", results: staticHits, status: "done" });
      return;
    }

    // Tier 2 — debounce then Census API
    if (q.length < 3) {
      dispatch({ type: "SET_RESULTS", results: [], status: "idle" });
      return;
    }

    dispatch({ type: "SET_STATUS", status: "loading" });

    debounceRef.current = setTimeout(async () => {
      const { city, state } = parseQuery(q);
      const query = state ? `${city} ${state}` : city;
      try {
        const res = await fetch(`/api/city-search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) { dispatch({ type: "SET_RESULTS", results: [], status: "error" }); return; }
        const data: CityResult[] = await res.json();
        if (data.length > 0) {
          dispatch({ type: "SET_RESULTS", results: data, status: "done" });
        } else {
          dispatch({ type: "SET_RESULTS", results: [], status: "error" });
        }
      } catch {
        dispatch({ type: "SET_RESULTS", results: [], status: "error" });
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return { results, status };
}
