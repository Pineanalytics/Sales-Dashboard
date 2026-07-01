import { create } from "zustand";
import type { Dataset, DatasetSnapshotSummary } from "./types";

export const VIEW_KEYS = [
  "overview",
  "ytd",
  "trends",
  "coverage",
  "profitability",
  "stock",
  "h1",
] as const;

export type ViewKey = (typeof VIEW_KEYS)[number];

export const VIEW_LABELS: Record<ViewKey, string> = {
  overview: "Overview",
  ytd: "YTD Performance",
  trends: "Trends & Forecast",
  coverage: "Coverage",
  profitability: "Profitability",
  stock: "Stock Balance",
  h1: "H1 Balances",
};

interface DashboardState {
  dataset: Dataset | null;
  status: "idle" | "loading" | "error";
  error: string | null;
  view: ViewKey;
  selectedPrincipal: string | null; // Principal.name, or null for "All Principals"
  sidebarOpen: boolean;
  history: DatasetSnapshotSummary[];

  setDataset: (dataset: Dataset | null) => void;
  setView: (view: ViewKey) => void;
  selectPrincipal: (name: string | null) => void;
  setSidebarOpen: (open: boolean) => void;

  fetchLatest: () => Promise<void>;
  fetchSnapshot: (id: string) => Promise<void>;
  fetchHistory: () => Promise<void>;
  uploadFile: (file: File) => Promise<{ ok: boolean; error?: string }>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  dataset: null,
  status: "idle",
  error: null,
  view: "overview",
  selectedPrincipal: null,
  sidebarOpen: false,
  history: [],

  setDataset: (dataset) => set({ dataset, status: "idle", error: null }),
  setView: (view) => set({ view }),
  selectPrincipal: (name) => set({ selectedPrincipal: name }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  fetchLatest: async () => {
    set({ status: "loading", error: null });
    try {
      const res = await fetch("/api/dataset", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load dataset.");
      set({ dataset: body.dataset, status: "idle" });
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
      set({ dataset: body.dataset, status: "idle", selectedPrincipal: null });
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
      set({ dataset: body.dataset, status: "idle", error: null, selectedPrincipal: null });
      get().fetchHistory();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      set({ status: "error", error: message });
      return { ok: false, error: message };
    }
  },
}));
