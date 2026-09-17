import { describe, it, expect } from "vitest";
import { createDevOtpClient } from "./termii.js";

describe("dev OTP fallback client (OTP_DEV_FALLBACK)", () => {
  it("verifies the exact code it just generated", async () => {
    const client = createDevOtpClient();
    const { pinId, devCode } = await client.sendOtp("+2348012345678");

    expect(pinId).toEqual(expect.any(String));
    expect(devCode).toMatch(/^\d{6}$/);

    const { verified } = await client.verifyOtp(pinId, devCode!);
    expect(verified).toBe(true);
  });

  it("rejects the wrong code", async () => {
    const client = createDevOtpClient();
    const { pinId, devCode } = await client.sendOtp("+2348012345678");

    const { verified } = await client.verifyOtp(pinId, devCode === "000000" ? "111111" : "000000");
    expect(verified).toBe(false);
  });

  it("rejects a pinId it never issued", async () => {
    const client = createDevOtpClient();
    const { verified } = await client.verifyOtp("never-issued", "123456");
    expect(verified).toBe(false);
  });

  it("keeps separate codes for separate sendOtp calls, even for the same phone", async () => {
    const client = createDevOtpClient();
    const first = await client.sendOtp("+2348012345678");
    const second = await client.sendOtp("+2348012345678");

    expect(first.pinId).not.toBe(second.pinId);
    // the first pinId only ever verifies against the first code
    expect((await client.verifyOtp(first.pinId, second.devCode!)).verified).toBe(false);
    expect((await client.verifyOtp(first.pinId, first.devCode!)).verified).toBe(true);
  });
});
