import { getDb } from "../db/index";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Initialize sessions table
export function initSessionsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);
}

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export function validateCredentials(username: string, password: string): boolean {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

export function createSession(): string {
  initSessionsTable();
  const db = getDb();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  db.run(
    "INSERT INTO sessions (token, expires_at) VALUES (?, ?)",
    [token, expiresAt]
  );

  return token;
}

export function validateSession(token: string | null): boolean {
  if (!token) return false;

  initSessionsTable();
  const db = getDb();

  // Clean up expired sessions
  db.run("DELETE FROM sessions WHERE expires_at < datetime('now')");

  const session = db.query<{ token: string }, [string]>(
    "SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(token);

  return !!session;
}

export function deleteSession(token: string): void {
  initSessionsTable();
  const db = getDb();
  db.run("DELETE FROM sessions WHERE token = ?", [token]);
}

export function getSessionFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split("=");
    if (name === "session") {
      return value;
    }
  }
  return null;
}
