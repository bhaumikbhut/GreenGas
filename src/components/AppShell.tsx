"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useFleet } from "@/components/FleetProvider";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { trucks, filtered, updatedLabel, data, productFilter, statusFilter } =
    useFleet();
  const onMap = pathname === "/map";
  const onTrips = pathname === "/trips";
  const onFleet = pathname === "/" || pathname === "";
  const productScoped =
    productFilter === "ALL"
      ? trucks.length
      : trucks.filter((t) => t.productLine === productFilter).length;

  const navLink = (
    href: string,
    active: boolean,
    label: string,
    className = "",
  ) => (
    <Link
      href={href}
      className={`min-h-9 rounded-lg px-3 text-sm font-medium leading-9 transition lg:px-4 ${
        active ? "bg-white text-[var(--gg-forest)]" : "text-[#c5ddd0]"
      } ${className}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--gg-bg)] text-[var(--gg-ink)]">
      <header className="safe-pad-x safe-pad-top shrink-0 border-b border-white/10 bg-[var(--gg-forest)] pb-2 pt-2 text-white lg:pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-lg tracking-tight lg:text-xl">
                Green Gas
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#b7d4c4]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6ee7a8] opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#6ee7a8]" />
                </span>
                Live
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[#c5ddd0] lg:text-xs">
              {productScoped} trucks
              {productFilter !== "ALL" ? (
                <span className="opacity-80">
                  {" "}
                  ({productFilter === "LPG" ? "LPG" : "Propane"})
                </span>
              ) : null}
              <span className="mx-1.5 text-white/30">·</span>
              Updated {updatedLabel}
              {(onFleet || onMap) &&
              (statusFilter !== "ALL" ||
                productFilter !== "ALL" ||
                filtered.length !== productScoped) ? (
                <>
                  <span className="mx-1.5 text-white/30">·</span>
                  Showing {filtered.length}
                </>
              ) : null}
            </p>
          </div>

          <nav className="hidden shrink-0 gap-1 rounded-xl bg-white/10 p-1 md:flex">
            {navLink("/", onFleet, "Fleet")}
            {navLink("/map", onMap, "Map")}
            {navLink("/trips", onTrips, "Trips")}
          </nav>
        </div>
      </header>

      {(data?.errors?.length || data?.error) && (
        <div className="safe-pad-x shrink-0 border-b border-[#f0c9a0] bg-[#fff7ed] py-2.5 text-sm text-[#7a3f10]">
          {data.error || data.errors?.join(" · ")}
        </div>
      )}

      <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>

      <nav className="safe-pad-x safe-pad-bottom grid shrink-0 grid-cols-3 gap-1 border-t border-[var(--gg-line)] bg-white px-2 pt-1.5 md:hidden">
        <Link
          href="/"
          className={`min-h-12 rounded-xl text-center text-sm font-medium transition ${
            onFleet
              ? "bg-[#e8f3ec] text-[var(--gg-forest)]"
              : "text-[var(--gg-muted)]"
          }`}
        >
          <span className="block pt-1.5">Fleet</span>
          <span className="block text-[10px] font-normal opacity-70">
            {filtered.length} trucks
          </span>
        </Link>
        <Link
          href="/map"
          className={`min-h-12 rounded-xl text-center text-sm font-medium transition ${
            onMap
              ? "bg-[#e8f3ec] text-[var(--gg-forest)]"
              : "text-[var(--gg-muted)]"
          }`}
        >
          <span className="block pt-1.5">Map</span>
          <span className="block text-[10px] font-normal opacity-70">
            Live GPS
          </span>
        </Link>
        <Link
          href="/trips"
          className={`min-h-12 rounded-xl text-center text-sm font-medium transition ${
            onTrips
              ? "bg-[#e8f3ec] text-[var(--gg-forest)]"
              : "text-[var(--gg-muted)]"
          }`}
        >
          <span className="block pt-1.5">Trips</span>
          <span className="block text-[10px] font-normal opacity-70">
            Port → factory
          </span>
        </Link>
      </nav>
    </div>
  );
}
