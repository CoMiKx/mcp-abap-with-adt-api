type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export function createLogger(name: string) {
  return {
    error: (message: string, meta?: Record<string, unknown>) => 
      log('error', name, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => 
      log('warn', name, message, meta),
    info: (message: string, meta?: Record<string, unknown>) => 
      log('info', name, message, meta),
    debug: (message: string, meta?: Record<string, unknown>) => 
      log('debug', name, message, meta)
  };
}

function log(level: LogLevel, name: string, message: string, meta?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    service: name,
    message,
    ...meta
  };
  
  // stdout carries the MCP JSON-RPC stream, so every log line must go to stderr
  console.error(JSON.stringify(logEntry));
}

export type Logger = ReturnType<typeof createLogger>;
