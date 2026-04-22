import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "7d" });
}

export function verifyAccessToken(
  token: string,
  secret: string,
): { sub: string } {
  const decoded = jwt.verify(token, secret);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof (decoded as { sub?: unknown }).sub !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  return { sub: (decoded as { sub: string }).sub };
}
