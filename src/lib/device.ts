/** Anonymous per-install id (no personal data). Used for tile-session caps and alerts without an account. */
const KEY = 'sv_device_id';
let memo: string | undefined;

export function deviceId(): string {
  if (memo) return memo;
  try {
    memo = localStorage.getItem(KEY) ?? undefined;
    if (!memo) {
      memo = crypto.randomUUID();
      localStorage.setItem(KEY, memo);
    }
  } catch {
    memo = memo ?? crypto.randomUUID();
  }
  return memo;
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`sv_${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`sv_${key}`, JSON.stringify(value));
  } catch {
    /* private mode / storage blocked: preferences just don't persist */
  }
}
