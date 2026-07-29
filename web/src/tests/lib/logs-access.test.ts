import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/lib/store";

const baseSession = {
  sub: "user-1",tenantId: "tenant-1",role: "manager",planRole: "user",
  userLevel: "manager" as const,name: "Manager",jti: "jti",isSuperAdmin: false,
  mustChange: false,exp: 9999999999,
};

describe("System Logs navigation access", () => {
  beforeEach(() => {
    useStore.setState({ session: { ...baseSession,permissions: [] } });
  });

  it("hides logs without a logs or platform permission", () => {
    expect(useStore.getState().can("logs")).toBe(false);
  });

  it("allows logs.system.view", () => {
    useStore.setState({ session: { ...baseSession,permissions: ["logs.system.view"] } });
    expect(useStore.getState().can("logs")).toBe(true);
  });

  it("allows platform.audit.view", () => {
    useStore.setState({ session: { ...baseSession,permissions: ["platform.audit.view"] } });
    expect(useStore.getState().can("logs")).toBe(true);
  });
});
