export function sequentialIds() {
  let sequence = 0;
  return {
    uuid: (): string => {
      sequence += 1;
      return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
    },
  };
}
