import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

const PAGES = [
  { to: "/", label: "Explorer", end: true },
  { to: "/hypothesis", label: "Signal Tests", end: false },
  { to: "/synthetic", label: "Synthetic", end: false },
  { to: "/baskets", label: "Baskets", end: false },
];

export default function TopNav() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  return (
    <header className="topnav">
      <h1>Prosperity Market Analyzer</h1>
      <nav className="pages">
        {PAGES.map((p) => (
          <NavLink
            key={p.to}
            to={p.to}
            end={p.end}
            className={({ isActive }) =>
              "page-link" + (isActive ? " active" : "")
            }
          >
            {p.label}
          </NavLink>
        ))}
      </nav>
      <span className="status">
        {health.isLoading
          ? "checking…"
          : health.error
            ? "API offline"
            : `v${health.data?.version} • ${health.data?.status}`}
      </span>
    </header>
  );
}
