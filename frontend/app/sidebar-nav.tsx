"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/clips", label: "Clips" },
  { href: "/settings", label: "Settings" },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="space-y-3">
      {navigationItems.map(({ href, label }) => {
        const isActive = href === "/"
          ? pathname === "/"
          : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`block rounded-lg border-l-2 px-4 py-3 transition-colors ${
              isActive
                ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                : "border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
