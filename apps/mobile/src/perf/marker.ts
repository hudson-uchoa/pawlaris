export interface StartupMarker {
  dashboardInteractive(): void;
}

export function createStartupMarker(output: (message: string) => void): StartupMarker {
  void output;
  throw new Error('Startup marker not implemented');
}
