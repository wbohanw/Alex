const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

let threshold: number = LEVELS.info;

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level] ?? LEVELS.info;
}

function emit(level: LogLevel, scope: string, message: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (extra !== undefined) console[level === "debug" ? "log" : level](line, extra);
  else console[level === "debug" ? "log" : level](line);
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit("error", scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof logger>;
