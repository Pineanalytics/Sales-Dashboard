import { create } from "zustand";
import type { Dataset, DatasetSnapshotSummary } from "./types";
import { getDefaultPeriod, type PeriodSelection } from "./timeIntelligence";

export const VIEW_KEYS = [
  "overview",
  "timeIntelligence",
  "coverage",
  "repPerformance",
  "customerBrand",
  "profitability",
  "plStatement",
  "stock",
] as const;

export type ViewKey = (typeof VIEW_KEYS)[number];

export const VIEW_LABELS: Record<ViewKey, string> = {
  overview: "Overview",
  timeIntelligence: "Time Intelligence",
  coverage: "Coverage & Productivity",
  repPerformance: "Rep Performance",
  customerBrand: "Customer & Brand",
  profitability: "Profitability",
  plStatement: "P&L Statement",
  stock: "Stock Balance",
};

interface DashboardState {
  dataset: Dataset | null;
  status: "idle" | "loading" | "error";
  error: string | null;
  view: ViewKey;
  selectedPrincipalKey: string | null; // normalized brand key, or null for "All Principals"
  selectedPeriod: PeriodSelection;
  // True once the user has actively touched the period slicer. While false, Overview
  // shows a broad YTD/H1/H2 summary instead of a single narrow period — matching "my
  // pivots have all-month performance but the scheduler only factors the slicer I've
  // selected" from the original ask: land on the general picture, not a default MTD sliver.
  hasUserSelectedPeriod: boolean;
  sidebarOpen: boolean;
  history: DatasetSnapshotSummary[];

  setDataset: (dataset: Dataset | null) => void;
  setView: (view: ViewKey) => void;
  selectPrincipal: (key: string | null) => void;
  setPeriod: (period: PeriodSelection) => void;
  clearAllFilters: () => void;
  setSidebarOpen: (open: boolean) => void;

  fetchLatest: () => Promise<void>;
  fetchSnapshot: (id: string) => Promise<void>;
  fetchHistory: () => Promise<void>;
  uploadFile: (file: File) => Promise<{ ok: boolean; error?: string }>;
}

const EMPTY_PERIOD: PeriodSelection = { kind: "MTD", year: "" };

export const useDashboardStore = create<DashboardState>((set, get) => ({
  dataset: null,
  status: "idle",
  error: null,
  view: "overview",
  selectedPrincipalKey: null,
  selectedPeriod: EMPTY_PERIOD,
  hasUserSelectedPeriod: false,
  sidebarOpen: false,
  history: [],

  setDataset: (dataset) =>
    set({
      dataset,
      status: "idle",
      error: null,
      selectedPeriod: dataset ? getDefaultPeriod(dataset) : EMPTY_PERIOD,
      hasUserSelectedPeriod: false,
    }),
  setView: (view) => set({ view }),
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
