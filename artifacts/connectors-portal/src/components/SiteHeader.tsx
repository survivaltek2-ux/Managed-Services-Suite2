import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";

export function SiteHeader() {
  const { isAuthenticated, connector, logout } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 text-sm font-bold text-white">
            SS
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">Siebert Services</div>
            <div className="text-xs text-slate-500">Connector Program</div>
          </div>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {isAuthenticated ? (
            <>
              <Link href="/dashboard" className="font-medium text-slate-700 hover:text-slate-900">
                Dashboard
              </Link>
              <span className="hidden text-slate-400 md:inline">|</span>
              <span className="hidden text-slate-600 md:inline">
                {connector?.firstName} {connector?.lastName}
              </span>
              <button
                onClick={() => {
                  logout();
                  setLocation("/");
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="font-medium text-slate-700 hover:text-slate-900">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-indigo-600 px-4 py-1.5 font-medium text-white hover:bg-indigo-700"
              >
                Become a Connector
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
