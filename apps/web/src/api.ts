export type AuthResponse = {
  token: string;
  user: { id: string; email: string };
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

export async function apiBoards(token: string): Promise<
  { id: string; name: string; createdAt: Date | null }[]
> {
  const res = await fetch("/api/boards", {
    headers: { Authorization: `Bearer ${token}` },
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

export async function apiStrokes(
  token: string,
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
    headers: { Authorization: `Bearer ${token}` },
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
