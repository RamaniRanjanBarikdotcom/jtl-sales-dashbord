export function syncAgentStatusLabel(status?: string | null) {
    return status ? status.replace(/_/g," ") : "Never connected";
}

export function syncCommandStatusLabel(status: string) {
    return status === "queued" ? "Queued — waiting for engine" : status.replace(/_/g," ");
}

export function hasRealProgress(progress?: number | null) {
    return progress != null && Number.isFinite(progress);
}
