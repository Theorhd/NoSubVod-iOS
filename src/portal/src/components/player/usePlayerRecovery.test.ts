// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { usePlayerRecovery } from "./usePlayerRecovery";
import { expect, test, describe } from "vitest";

describe("usePlayerRecovery", () => {
  test("allows initial recovery and blocks quick consecutive attempts", () => {
    const { result } = renderHook(() => usePlayerRecovery());
    let now = 3000;

    // First attempt should succeed
    expect(result.current.attemptRecovery(now)).toBe(true);

    // Attempt within 2.5s should fail
    now += 1000;
    expect(result.current.attemptRecovery(now)).toBe(false);

    // Attempt after 2.5s should succeed
    now += 2000;
    expect(result.current.attemptRecovery(now)).toBe(true);
  });

  test("blocks after 6 attempts in window", () => {
    const { result } = renderHook(() => usePlayerRecovery());
    let now = 10000;

    for (let i = 0; i < 6; i++) {
      expect(result.current.attemptRecovery(now)).toBe(true);
      now += 3000; // pass the 2.5s threshold
    }

    // 7th attempt should fail
    expect(result.current.attemptRecovery(now)).toBe(false);
  });
});
