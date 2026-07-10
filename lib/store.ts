import { create } from "zustand";
import type { Dataset, DatasetSnapshotSummary } from "./types";
import { getDefaultPeriod, type PeriodSelection } from "./timeIntelligence";

interface DashboardState {
  dataset: Dataset | null;
  status: "idle" | "loading" | "error";
  error: string | null;
  selectedPrincipalKey: string | null; // normalized brand key, or null for "All Principals"
  selectedPeriod: PeriodSelection;
  // True once the user has actively touched the period slicer. While false, Overview
  // shows a broad YTD/H1/H2 summary instead of a single narrow period — matching "my
  // pivots have all-month performance but the scheduler only factors the slicer I've
  // selected" from the original ask: land on the general picture, not a default MTD sliver.
  hasUserSelectedPeriod: boolean;
  sidebarOpen: boolean;
  // Desktop-only "resting" state for the sidebar rail (mobile always uses sidebarOpen's
  // full-drawer behavior instead). Persisted to localStorage so the choice survives page
  // reloads, not just client-side navigation. Hovering over a collapsed rail temporarily
  // reveals labels without changing this — see Sidebar.tsx's own hover state.
  sidebarCollapsed: boolean;
  history: DatasetSnapshotSummary[];

  setDataset: (dataset: Dataset | null) => void;
  selectPrincipal: (key: string | null) => void;
  setPeriod: (period: PeriodSelection) => void;
  clearAllFilters: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  fetchLatest: () => Promise<void>;
  /** Silently re-fetches the latest dataset in the background — unlike fetchLatest(),
   *  preserves the user's current period/principal selection instead of resetting to
   *  the default. Used to auto-refresh data on pane navigation without disrupting
   *  whatever the user was looking at. */
  refreshDataset: () => Promise<void>;
  fetchSnapshot: (id: string) => Promise<void>;
  fetchHistory: () => Promise<void>;
  uploadFile: (file: File) => Promise<{ ok: boolean; error?: string }>;
}

const EMPTY_PERIOD: PeriodSelection = { kind: "MTD", year: "" };
// Always starts false (matching SSR, which has no localStorage) — Sidebar.tsx restores
// the real persisted value from localStorage in a useEffect after mount, so the very
// first client render still matches the server-rendered HTML and avoids a hydration
// mismatch. See SIDEBAR_COLLAPSED_KEY usage there.
export const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

export const useDashboardStore = create<DashboardState>((set, get) => ({
  dataset: null,
  status: "idle",
  error: null,
  selectedPrincipalKey: null,
  selectedPeriod: EMPTY_PERIOD,
  hasUserSelectedPeriod: false,
  sidebarOpen: false,
  sidebarCollapsed: false,
  history: [],

  setDataset: (dataset) =>
    set({
      dataset,
      status: "idle",
      error: null,
      selectedPeriod: dataset ? getDefaultPeriod(dataset) : EMPTY_PERIOD,
      hasUserSelectedPeriod: false,
    }),
  selectPrincipal: (key) => set({ selectedPrincipalKey: key }),
  setPeriod: (period) => set({ selectedPeriod: period, hasUserSelectedPeriod: true }),
  clearAllFilters: () => {
    const { dataset } = get();
    set({
      selectedPrincipalKey: null,
      selectedPeriod: dataset ? getDefaultPeriod(dataset) : EMPTY_PERIOD,
      hasUserSelectedPeriod: false,
    });
  },
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    }
    set({ sidebarCollapsed: collapsed });
  },

  fetchLatest: async () => {
    set({ status: "loading", error: null });
    try {
      const res = await fetch("/api/dataset", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load dataset.");
      const dataset: Dataset = body.dataset;
      set({ dataset, status: "idle", selectedPeriod: getDefaultPeriod(dataset), hasUserSelectedPeriod: false });
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : "Failed to load dataset." });
    }
  },

  refreshDataset: async () => {
    try {
      const res = await fetch("/api/dataset", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) return; // background refresh — fail silently, keep showing the current dataset
      const dataset: Dataset | null = body.dataset;
      if (dataset) set({ dataset, error: null });
    } catch {
      // background refresh — network hiccups shouldn't surface as an error banner
    }
  },

  fetchSnapshot: async (id: string) => {
    set({ status: "loading", error: null });
    try {
      const res = await fetch(`/api/dataset?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load snapshot.");
      const dataset: Dataset = body.dataset;
      set({
        dataset,
        status: "idle",
        selectedPrincipalKey: null,
        selectedPeriod: getDefaultPeriod(dataset),
        hasUserSelectedPeriod: false,
      });
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : "Failed to load snapshot." });
    }
  },

  fetchHistory: async () => {
    try {
      const res = await fetch("/api/snapshots", { cache: "no-store" });
      const body = await res.json();
      if (res.ok) set({ history: body.snapshots ?? [] });
    } catch {
      // history is a nice-to-have; ignore failures silently
    }
  },

  uploadFile: async (file: File) => {
    set({ status: "loading", error: null });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        set({ status: "error", error: body.error || "Upload failed." });
        return { ok: false, error: body.error || "Upload failed." };
      }
      const dataset: Dataset = body.dataset;
      set({
        dataset,
        status: "idle",
        error: null,
        selectedPrincipalKey: null,
        selectedPeriod: getDefaultPeriod(dataset),
        hasUserSelectedPeriod: false,
      });
      get().fetchHistory();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      set({ status: "error", error: message });
      return { ok: false, error: message };
    }
  },
}));
