export interface StartupMarker {
  dashboardInteractive(): void;
}

export function createStartupMarker(output: (message: string) => void): StartupMarker {
  let emitted = false;
  return {
    dashboardInteractive() {
      if (emitted) return;
      emitted = true;
      output('PAWLARIS_PERF dashboard_interactive');
    },
  };
}
