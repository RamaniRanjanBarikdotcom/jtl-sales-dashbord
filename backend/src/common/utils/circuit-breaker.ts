export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  getState(): CircuitState {
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.state === 'open') {
      const elapsed = now - this.openedAt;
      if (elapsed < this.opts.resetTimeoutMs) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half_open';
    }

    try {
      const result = await operation();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.opts.failureThreshold) {
        this.state = 'open';
        this.openedAt = Date.now();
      }
      throw error;
    }
  }
}
