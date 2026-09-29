"use client";

import { useState } from "react";
import { TimestampsPineView } from "./timestamps/TimestampsPineView";
import { EablCallPerformanceView } from "./timestamps/EablCallPerformanceView";
import { EablDsrReviewView } from "./timestamps/EablDsrReviewView";
import { UpfieldDataEdgeView } from "./timestamps/UpfieldDataEdgeView";
import { UpfieldVisitsView } from "./timestamps/UpfieldVisitsView";
import { LeverageView } from "./timestamps/LeverageView";
import type { TimestampsModule } from "./timestamps/types";

/** Hub-and-spoke navigation across the six Timestamp systems (Pine hub +
 *  EABL calls/DSR + Upfield DataEdge/Visits + Unilever Leverage), all now
 *  reached via local state instead of their old standalone /timestamps/*
 *  routes — see SfaReportNavigator/EablReportTabs/UpfieldReportTabs, which
 *  take an onNavigate callback into this same state instead of a Link href. */
export function TimestampsModuleView() {
  const [activeModule, setActiveModule] = useState<TimestampsModule>("pine");

  switch (activeModule) {
    case "eabl-calls":
      return <EablCallPerformanceView onNavigate={setActiveModule} />;
    case "eabl-dsr":
      return <EablDsrReviewView onNavigate={setActiveModule} />;
    case "upfield-dataedge":
      return <UpfieldDataEdgeView onNavigate={setActiveModule} />;
    case "upfield-visits":
      return <UpfieldVisitsView onNavigate={setActiveModule} />;
    case "leverage":
      return <LeverageView onNavigate={setActiveModule} />;
    case "pine":
    default:
      return <TimestampsPineView onNavigate={setActiveModule} />;
  }
}
