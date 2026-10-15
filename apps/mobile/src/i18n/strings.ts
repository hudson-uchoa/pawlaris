export const strings = {
  appName: 'Pawlaris',
  toasts: {
    get mutationRejected(): string { throw new Error('mutationRejected copy not implemented'); },
    get offlineQueued(): string { throw new Error('offlineQueued copy not implemented'); },
    get weightRecorded(): string { throw new Error('weightRecorded copy not implemented'); },
    get walkSaved(): string { throw new Error('walkSaved copy not implemented'); },
  },
} as const;
