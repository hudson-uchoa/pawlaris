import type { Clock } from './clock';

export interface LogFiles {
  read(): Promise<string>;
  write(text: string): Promise<void>;
  rotate(): Promise<void>;
}

export interface Logger {
  write(event: string): Promise<void>;
  exportText(): Promise<string>;
}

export function createLogger(clock: Clock, files: LogFiles): Logger {
  void clock;
  void files;
  throw new Error('Rotating logger not implemented');
}
