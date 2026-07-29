import { describe,expect,it } from "vitest";
import {
    hasRealProgress,syncAgentStatusLabel,syncCommandStatusLabel,
} from "@/lib/sync-control";

describe("sync control real-data labels", () => {
    it("does not fabricate heartbeat state", () => {
        expect(syncAgentStatusLabel(null)).toBe("Never connected");
        expect(syncAgentStatusLabel("offline")).toBe("offline");
    });

    it("keeps queued commands distinct from running commands", () => {
        expect(syncCommandStatusLabel("queued")).toBe("Queued — waiting for engine");
        expect(syncCommandStatusLabel("running")).toBe("running");
    });

    it("shows progress only when the backend persisted a value", () => {
        expect(hasRealProgress(null)).toBe(false);
        expect(hasRealProgress(undefined)).toBe(false);
        expect(hasRealProgress(0)).toBe(true);
    });
});
