import { describe, expect, it } from "vitest";
import {
  autoAcceptFromPermissionPreset,
  parseAgentPermissionPreset,
  permissionPresetFromAutoAccept
} from "./agentPermissionPresets";
import {
  fromDeepAgentPermission,
  fromDeepAgentPermissionPreset,
  toDeepAgentPermission
} from "../components/deep-agent-composer/bridge";

describe("agentPermissionPresets", () => {
  it("parses aliases into the three dsh-aligned tiers", () => {
    expect(parseAgentPermissionPreset("default")).toBe("default");
    expect(parseAgentPermissionPreset("auto")).toBe("auto_review");
    expect(parseAgentPermissionPreset("full")).toBe("full_access");
    expect(parseAgentPermissionPreset("danger-full-access")).toBe("full_access");
  });

  it("keeps full_access distinct from auto_review", () => {
    expect(toDeepAgentPermission("full_access")).toBe("full_access");
    expect(fromDeepAgentPermissionPreset("full_access")).toBe("full_access");
    expect(fromDeepAgentPermission("full_access")).toBe(true);
    expect(autoAcceptFromPermissionPreset("full_access")).toBe(true);
    expect(permissionPresetFromAutoAccept(true)).toBe("auto_review");
  });
});
