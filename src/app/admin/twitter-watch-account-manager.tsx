"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type WatchAccount = {
  id: number;
  username: string;
  userIdStr: string | null;
  lastSinceId: string | null;
  enabled: boolean;
  includeReplies: boolean;
  includeRetweets: boolean;
  lastSyncedAt: string | null;
  lastProfileSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListPayload = {
  accounts?: WatchAccount[];
  error?: string;
};

type AccountPayload = {
  account?: WatchAccount;
  error?: string;
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

function normalizeUsername(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export default function TwitterWatchAccountManager() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<WatchAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");

  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/twitter/accounts", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json()) as ListPayload;
      if (!response.ok) {
        throw new Error(payload.error || "无法加载账号列表");
      }

      setAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
      setMessage("");
      setMessageTone("neutral");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法加载账号列表");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    function handleRefresh() {
      void loadAccounts();
    }

    window.addEventListener("twitter:accounts-refresh", handleRefresh);
    return () => {
      window.removeEventListener("twitter:accounts-refresh", handleRefresh);
    };
  }, [loadAccounts]);

  async function handleAddAccount() {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      setMessage("请输入有效的 Twitter 用户名");
      setMessageTone("error");
      return;
    }

    setSubmitting(true);
    setMessage("");
    setMessageTone("neutral");

    try {
      const response = await fetch("/api/admin/twitter/accounts", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: normalized,
        }),
      });
      const payload = (await response.json()) as AccountPayload;
      if (!response.ok || !payload.account) {
        throw new Error(payload.error || "添加账号失败");
      }

      setUsername("");
      setMessage(`已添加 @${payload.account.username}`);
      setMessageTone("neutral");
      await loadAccounts();
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加账号失败");
      setMessageTone("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleAccount(account: WatchAccount) {
    setSubmitting(true);
    setMessage("");
    setMessageTone("neutral");

    try {
      const response = await fetch(`/api/admin/twitter/accounts/${account.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: !account.enabled,
        }),
      });
      const payload = (await response.json()) as AccountPayload;
      if (!response.ok || !payload.account) {
        throw new Error(payload.error || "更新账号失败");
      }

      setMessage(payload.account.enabled ? `已启用 @${payload.account.username}` : `已停用 @${payload.account.username}`);
      await loadAccounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新账号失败");
      setMessageTone("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteAccount(account: WatchAccount) {
    setSubmitting(true);
    setMessage("");
    setMessageTone("neutral");

    try {
      const response = await fetch(`/api/admin/twitter/accounts/${account.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "删除账号失败");
      }

      setMessage(`已移除 @${account.username}`);
      await loadAccounts();
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除账号失败");
      setMessageTone("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="admin-twitter-watch">
      <header className="admin-twitter-watch-head">
        <div>
          <h3>Watch Accounts</h3>
          <p>这里配置每日同步的账号名单，修改后下一次手动或定时同步都会生效。</p>
        </div>
        <div className="admin-twitter-watch-form">
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="输入用户名，例如 karpathy"
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleAddAccount();
              }
            }}
          />
          <button type="button" onClick={() => void handleAddAccount()} disabled={submitting}>
            Add Account
          </button>
        </div>
      </header>

      {message ? (
        <p className={messageTone === "error" ? "admin-twitter-watch-feedback is-error" : "admin-twitter-watch-feedback"}>
          {message}
        </p>
      ) : null}

      <div className="admin-twitter-watch-table-shell">
        <table className="admin-twitter-watch-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Status</th>
              <th>Last Synced</th>
              <th>Since ID</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length > 0 ? (
              accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <div className="admin-twitter-watch-user">
                      <strong>@{account.username}</strong>
                      <span>{account.userIdStr ? `UID ${account.userIdStr}` : "UID pending"}</span>
                    </div>
                  </td>
                  <td>
                    <span className={account.enabled ? "admin-twitter-watch-badge is-enabled" : "admin-twitter-watch-badge is-disabled"}>
                      {account.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>{formatDateTime(account.lastSyncedAt)}</td>
                  <td>{account.lastSinceId ?? "-"}</td>
                  <td>
                    <div className="admin-twitter-watch-actions">
                      <button
                        type="button"
                        onClick={() => void handleToggleAccount(account)}
                        disabled={submitting}
                      >
                        {account.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => void handleDeleteAccount(account)}
                        disabled={submitting}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="admin-dash-empty">
                  {loading ? "Loading watch accounts..." : "No watch accounts configured."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
