"use client";

import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { FleetProvider } from "@/components/FleetProvider";

export default function TrackerLayout({ children }: { children: ReactNode }) {
  return (
    <FleetProvider>
      <AppShell>{children}</AppShell>
    </FleetProvider>
  );
}
