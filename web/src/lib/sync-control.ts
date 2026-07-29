export function syncAgentStatusLabel(status?: string | null) {
    return status ? status.replace(/_/g," ") : "Never connected";
}

export function syncCommandStatusLabel(status: string) {
    return status === "queued" ? "Queued — waiting for engine" : status.replace(/_/g," ");
}

export function hasRealProgress(progress?: number | null) {
    return progress != null && Number.isFinite(progress);
}

// Averages only runs the backend timed. Unfinished runs report no duration and
// must not be counted as 0ms, which would understate the real average.
export function averageRunLatencyMs(runs: Array<{ duration_ms?: number | null }>): number | null {
    const timed = runs.filter((run) => run.duration_ms != null && Number.isFinite(run.duration_ms));
    if (!timed.length) return null;
    return Math.round(timed.reduce((sum, run) => sum + Number(run.duration_ms), 0) / timed.length);
}
