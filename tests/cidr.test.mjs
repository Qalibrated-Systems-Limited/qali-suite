import { describe, it, expect } from "vitest";
import { ipInNetworks, isValidNetwork, clientIpFrom, parseIp } from "@/lib/net/cidr";

describe("office networks", () => {
  it("matches IPv4 addresses and blocks", () => {
    expect(ipInNetworks("41.90.12.7", ["41.90.12.0/24"])).toBe(true);
    expect(ipInNetworks("41.90.13.7", ["41.90.12.0/24"])).toBe(false);
    expect(ipInNetworks("196.201.214.5", ["196.201.214.5"])).toBe(true);
    expect(ipInNetworks("::ffff:41.90.12.7", ["41.90.12.0/24"])).toBe(true);
  });
  it("matches IPv6", () => {
    expect(ipInNetworks("2c0f:fe38:2001::15", ["2c0f:fe38::/32"])).toBe(true);
    expect(ipInNetworks("2c0f:fe39::1", ["2c0f:fe38::/32"])).toBe(false);
    expect(parseIp("::1")).toMatchObject({ version: 6, value: 1n });
  });
  it("rejects nonsense", () => {
    expect(isValidNetwork("41.90.12.0/33")).toBe(false);
    expect(isValidNetwork("not-an-ip")).toBe(false);
    expect(isValidNetwork("300.1.1.1")).toBe(false);
    expect(ipInNetworks("garbage", ["0.0.0.0/0"])).toBe(false);
  });
  it("believes the proxy's entry, not one the client wrote", () => {
    expect(clientIpFrom(new Map([["x-forwarded-for", "1.2.3.4, 41.90.12.7"]]))).toBe("41.90.12.7");
    expect(clientIpFrom(new Map([["x-real-ip", "41.90.12.7"]]))).toBe("41.90.12.7");
    expect(clientIpFrom(new Map())).toBeNull();
  });
});
