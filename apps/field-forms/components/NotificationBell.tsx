"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/assetTypes";

export default function NotificationBell({ userId }: { userId: string }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshCount();
    const interval = setInterval(refreshCount, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function refreshCount() {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .is("read_at", null);
    setUnreadCount(count ?? 0);
  }

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications((data ?? []) as AppNotification[]);

    const unreadIds = (data ?? []).filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length > 0) {
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
      setUnreadCount(0);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleOpen}
        aria-label="Notifications"
        className="relative text-[var(--ink-600)] hover:text-[var(--pine-700)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-[var(--rust-600)] text-white text-[10px] font-medium">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-[var(--line)] rounded-lg shadow-lg z-50">
          <div className="px-4 py-2 border-b border-[var(--line)]">
            <p className="text-xs font-mono-label uppercase tracking-wide text-[var(--ink-400)]">
              Notifications
            </p>
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--ink-400)] text-center">
              No notifications yet.
            </p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id} className="px-4 py-3 border-b border-[var(--line)] last:border-0">
                  <p className="text-sm text-[var(--ink-900)]">{n.message}</p>
                  <p className="text-xs text-[var(--ink-400)] mt-1">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
