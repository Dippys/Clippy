type LogLevel = "INFO" | "WARN" | "ERROR";

function writeLog(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;

  if (meta === undefined) {
    if (level === "ERROR") {
      console.error(`${prefix} ${message}`);
    } else if (level === "WARN") {
      console.warn(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
    return;
  }

  if (level === "ERROR") {
    console.error(`${prefix} ${message}`, meta);
  } else if (level === "WARN") {
    console.warn(`${prefix} ${message}`, meta);
  } else {
    console.log(`${prefix} ${message}`, meta);
  }
}

export function logInfo(message: string, meta?: unknown): void {
  writeLog("INFO", message, meta);
}

export function logWarn(message: string, meta?: unknown): void {
  writeLog("WARN", message, meta);
}

export function logError(message: string, meta?: unknown): void {
  writeLog("ERROR", message, meta);
}
