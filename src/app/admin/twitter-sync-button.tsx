"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type StatusPayload = {
  running?: boolean;
  startedAt?: number | null;
  error?: string;
};

type CollectPayload = {
  error?: string;
  result?: {
    accounts: number;
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
  };
};

function formatStartedAt(timestamp?: number | null) {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

export default function TwitterSyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch("/api/admin/twitter/collect", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as StatusPayload;
        if (cancelled) {
          return;
        }

        const isRunning = Boolean(payload.running);
        setRunning(isRunning);
        if (isRunning) {
          const startedAt = formatStartedAt(payload.startedAt);
          setMessage(startedAt ? `同步任务进行中，开始于 ${startedAt}` : "同步任务进行中");
          setMessageTone("neutral");
        }
      } catch {
        if (!cancelled) {
          setMessage("无法获取同步状态");
          setMessageTone("error");
        }
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSync() {
    setSubmitting(true);
    setMessage("");
    setMessageTone("neutral");

    try {
      const response = await fetch("/api/admin/twitter/collect", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      const payload = (await response.json()) as CollectPayload & StatusPayload;

      if (response.status === 409) {
        setRunning(true);
        const startedAt = formatStartedAt(payload.startedAt);
        setMessage(startedAt ? `同步任务已在运行，开始于 ${startedAt}` : "同步任务已在运行");
        return;
      }

      if (!response.ok || !payload.result) {
        setMessage(payload.error || "同步失败");
        setMessageTone("error");
        setRunning(false);
        return;
      }

      setRunning(false);
      setMessage(
        `已同步 ${payload.result.accounts} 个账号，抓取 ${payload.result.fetched} 条，新增 ${payload.result.created} 条`,
      );
      window.dispatchEvent(new Event("twitter:accounts-refresh"));
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setRunning(false);
      setMessage("同步失败，请稍后重试");
      setMessageTone("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-twitter-sync">
      <button type="button" onClick={() => void handleSync()} disabled={submitting || running}>
        {submitting ? "Syncing..." : running ? "Sync Running" : "Sync Twitter"}
      </button>
      {message ? (
        <p className={messageTone === "error" ? "admin-twitter-sync-feedback is-error" : "admin-twitter-sync-feedback"}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
