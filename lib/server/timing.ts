export interface TimingSample {
  name: string;
  ms: number;
}

export interface TimedResult<T> {
  value: T;
  timing: TimingSample;
}

function nowMs(): number {
  return performance.now();
}

function elapsedSince(start: number): number {
  return Number((nowMs() - start).toFixed(3));
}

export function timingMap(samples: TimingSample[]): Record<string, number> {
  return Object.fromEntries(samples.map((sample) => [sample.name, sample.ms]));
}

export function measureSync<T>(name: string, fn: () => T): TimedResult<T> {
  const start = nowMs();
  const value = fn();
  return { value, timing: { name, ms: elapsedSince(start) } };
}

export async function measureAsync<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<TimedResult<T>> {
  const start = nowMs();
  const value = await fn();
  return { value, timing: { name, ms: elapsedSince(start) } };
}

export function createTimer() {
  const startedAt = nowMs();
  const samples: TimingSample[] = [];

  return {
    async asyncPhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const result = await measureAsync(name, fn);
      samples.push(result.timing);
      return result.value;
    },
    syncPhase<T>(name: string, fn: () => T): T {
      const result = measureSync(name, fn);
      samples.push(result.timing);
      return result.value;
    },
    samples(): TimingSample[] {
      return [...samples];
    },
    total(name = "total"): TimingSample {
      return { name, ms: elapsedSince(startedAt) };
    },
  };
}
