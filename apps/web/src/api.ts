export type AuthResponse = {
  token: string;
  user: { id: string; email: string; role: "User" | "Admin" | "View-Only" };
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || res.statusText);
  }
}

export async function apiRegister(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson<AuthResponse & { error?: string }>(res);
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? "Register failed");
  }
  return body;
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson<AuthResponse & { error?: string }>(res);
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? "Login failed");
  }
  return body;
}

export async function apiBoards(token?: string | null): Promise<
  { id: string; name: string; createdAt: Date | null }[]
> {
  const res = await fetch("/api/boards", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await readJson<{ boards: { id: string; name: string; createdAt: string | null }[] }>(
    res,
  );
  if (!res.ok) {
    throw new Error((body as unknown as { error?: string }).error ?? "Failed to load boards");
  }
  return body.boards.map((b) => ({
    ...b,
    createdAt: b.createdAt ? new Date(b.createdAt) : null,
  }));
}

export async function apiMe(
  token: string,
): Promise<{ id: string; email: string; role: "User" | "Admin" | "View-Only" }> {
  const res = await fetch("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await readJson<{
    user?: { id: string; email: string; role: "User" | "Admin" | "View-Only" };
    error?: string;
  }>(res);
  if (!res.ok || !body.user) {
    throw new Error(body.error ?? "Failed to load user");
  }
  return body.user;
}

export async function apiStrokes(
  token: string | null | undefined,
  boardId: string,
): Promise<
  {
    id: string;
    boardId: string;
    userId: string;
    payload: import("./types").StrokePayload;
    createdAt: string | null;
  }[]
> {
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/strokes`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await readJson<{
    strokes: {
      id: string;
      boardId: string;
      userId: string;
      payload: import("./types").StrokePayload;
      createdAt: string | null;
    }[];
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to load strokes");
  }
  return body.strokes;
}

export async function apiDeleteStroke(token: string, strokeId: string): Promise<void> {
  const res = await fetch(`/api/strokes/${encodeURIComponent(strokeId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) return;
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    throw new Error(body.error ?? "Failed to delete stroke");
  } catch {
    throw new Error(text || "Failed to delete stroke");
  }
}

export type AdminUser = {
  id: string;
  email: string;
  role: "User" | "Admin" | "View-Only";
  createdAt: string | null;
};

export async function apiAdminUsers(token: string): Promise<AdminUser[]> {
  const res = await fetch("/api/admin/users", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await readJson<{ users?: AdminUser[]; error?: string }>(res);
  if (!res.ok || !body.users) throw new Error(body.error ?? "Failed to load users");
  return body.users;
}

export async function apiAdminSetUserRole(
  token: string,
  userId: string,
  role: "User" | "Admin" | "View-Only",
): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (res.ok) return;
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    throw new Error(body.error ?? "Failed to update role");
  } catch {
    throw new Error(text || "Failed to update role");
  }
}
