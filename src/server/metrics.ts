/**
 * Real-time Telemetry and Circuit Breaker Tracking for Sami Server Persistence Layer
 */

interface FirestoreTelemetryStats {
  reads: number;
  writes: number;
  cacheHits: number;
  circuitBreakerActive: boolean;
  circuitBreakerUntil: number | null;
  errorsCount: number;
  lastError: {
    caller: string;
    collection: string;
    message: string;
    timestamp: number;
  } | null;
  readsByCollection: Record<string, number>;
  cacheHitsByCollection: Record<string, number>;
}

class FirestoreMetricsTracker {
  private stats: FirestoreTelemetryStats = {
    reads: 0,
    writes: 0,
    cacheHits: 0,
    circuitBreakerActive: false,
    circuitBreakerUntil: null,
    errorsCount: 0,
    lastError: null,
    readsByCollection: {},
    cacheHitsByCollection: {},
  };

  public setCircuitBreaker(untilMs: number): void {
    this.stats.circuitBreakerActive = Date.now() < untilMs;
    this.stats.circuitBreakerUntil = untilMs;
  }

  public isCircuitBreakerActive(): boolean {
    if (this.stats.circuitBreakerUntil && Date.now() >= this.stats.circuitBreakerUntil) {
      this.stats.circuitBreakerActive = false;
      this.stats.circuitBreakerUntil = null;
    }
    return this.stats.circuitBreakerActive;
  }

  public recordError(caller: string, collection: string, err: any): void {
    this.stats.errorsCount += 1;
    this.stats.lastError = {
      caller,
      collection,
      message: err?.message || String(err),
      timestamp: Date.now(),
    };
  }

  public recordRead(_caller: string, collection: string, _type: string, count: number, isCache: boolean): void {
    if (isCache) {
      this.stats.cacheHits += count;
      this.stats.cacheHitsByCollection[collection] = (this.stats.cacheHitsByCollection[collection] || 0) + count;
    } else {
      this.stats.reads += count;
      this.stats.readsByCollection[collection] = (this.stats.readsByCollection[collection] || 0) + count;
    }
  }

  public recordWrite(collection: string, count = 1): void {
    this.stats.writes += count;
  }

  public getSummaryReport() {
    return {
      ...this.stats,
      uptimeSeconds: Math.floor(process.uptime()),
      circuitBreakerRemainingSeconds: this.stats.circuitBreakerUntil
        ? Math.max(0, Math.floor((this.stats.circuitBreakerUntil - Date.now()) / 1000))
        : 0,
      timestamp: new Date().toISOString(),
    };
  }
}

export const firestoreMetrics = new FirestoreMetricsTracker();
