import { createServer, request as requestHttp, type Server } from "node:http";
import { connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { lighthouseChromeFlags } from "../../src/audit/scanners/lighthouse";
import {
  isPrivateAddress,
  pinnedLookup,
  resolveTargetUrl,
  type HostResolver,
} from "../../src/audit/network";
import { startAuditProxy, type AuditProxy } from "../../src/audit/proxy";

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Test server did not bind");
  return address.port;
};

const requestThroughProxy = async (
  proxyUrl: string,
  targetUrl: string,
): Promise<string> => {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = requestHttp({
      hostname: proxy.hostname,
      port: proxy.port,
      path: targetUrl,
      headers: { host: new URL(targetUrl).host },
    });
    request.once("response", (response) => {
      const chunks: Array<Buffer> = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () =>
        resolve(Buffer.concat(chunks).toString("utf8")),
      );
    });
    request.once("error", reject);
    request.end();
  });
};

describe("SEO audit network boundary", () => {
  const servers: Array<Server> = [];
  const proxies: Array<AuditProxy> = [];

  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("rejects mapped, private, metadata, transition, and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "168.63.129.16",
      "169.254.169.254",
      "192.0.2.1",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::127.0.0.1",
      "::ffff:0:127.0.0.1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("rejects mixed DNS answers and pins the accepted resolution", async () => {
    let calls = 0;
    const resolve: HostResolver = async () => {
      calls += 1;
      return calls === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    };
    const addresses = await resolveTargetUrl(
      new URL("https://rebind.test"),
      false,
      resolve,
    );
    const lookup = pinnedLookup(addresses);
    const pinned = await new Promise<unknown>((resolveLookup, reject) =>
      lookup("rebind.test", { all: true }, (error, address) =>
        error ? reject(error) : resolveLookup(address),
      ),
    );
    expect(calls).toBe(1);
    expect(pinned).toEqual([{ address: "93.184.216.34", family: 4 }]);

    await expect(
      resolveTargetUrl(new URL("https://mixed.test"), false, async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow("Private target is not allowed");
  });

  it("pins ordinary proxy requests and CONNECT tunnels to the approved address", async () => {
    const destination = createServer((request, response) => {
      response.end(`${request.method} ${request.url} ${request.headers.host}`);
    });
    servers.push(destination);
    const port = await listen(destination);
    const resolve: HostResolver = async () => [
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ];
    const proxy = await startAuditProxy({ allowPrivate: true, resolve });
    proxies.push(proxy);

    await expect(
      requestThroughProxy(proxy.url, `http://public.test:${port}/evidence?q=1`),
    ).resolves.toBe(`GET /evidence?q=1 public.test:${port}`);

    const proxyAddress = new URL(proxy.url);
    const tunneled = await new Promise<string>((resolveTunnel, reject) => {
      const socket = connect(Number(proxyAddress.port), proxyAddress.hostname);
      let received = "";
      socket.setEncoding("utf8");
      socket.once("connect", () =>
        socket.write(`CONNECT public.test:${port} HTTP/1.1\r\n\r\n`),
      );
      socket.on("data", (chunk: string) => {
        received += chunk;
        if (
          received.includes("200 Connection Established") &&
          !received.includes("GET /tunnel")
        ) {
          socket.write(
            `GET /tunnel HTTP/1.1\r\nHost: public.test:${port}\r\nConnection: close\r\n\r\n`,
          );
        }
      });
      socket.once("end", () => resolveTunnel(received));
      socket.once("error", reject);
    });
    expect(tunneled).toContain("200 Connection Established");
    expect(tunneled).toContain(`GET /tunnel public.test:${port}`);
  });

  it("denies mapped private destinations at the proxy without dialing them", async () => {
    let destinationRequests = 0;
    const destination = createServer((_request, response) => {
      destinationRequests += 1;
      response.end("unsafe");
    });
    servers.push(destination);
    const port = await listen(destination);
    const proxy = await startAuditProxy({
      allowPrivate: false,
      resolve: async () => [{ address: "::ffff:127.0.0.1", family: 6 }],
    });
    proxies.push(proxy);

    await expect(
      requestThroughProxy(proxy.url, `http://mapped.test:${port}/`),
    ).resolves.toContain("Private target is not allowed");
    expect(destinationRequests).toBe(0);
  });

  it("closes proxy clients while DNS resolution is pending without a direct fallback", async () => {
    let resolutionStarted!: () => void;
    const resolving = new Promise<void>((resolve) => { resolutionStarted = resolve; });
    let finishResolution!: () => void;
    const resolution = new Promise<Awaited<ReturnType<HostResolver>>>((resolve) => {
      finishResolution = () => resolve([{ address: "1.2.3.4", family: 4 }]);
    });
    const proxy = await startAuditProxy({
      allowPrivate: false,
      resolve: () => { resolutionStarted(); return resolution; },
    });
    proxies.push(proxy);
    const proxyAddress = new URL(proxy.url);
    const errors: Array<NodeJS.ErrnoException> = [];
    let received = "";
    const clientClosed = new Promise<void>((resolveClose) => {
      const socket = connect(Number(proxyAddress.port), proxyAddress.hostname);
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => { received += chunk; });
      socket.once("connect", () =>
        socket.write("CONNECT public.test:65000 HTTP/1.1\r\n\r\n"),
      );
      socket.once("close", () => resolveClose());
      // Abrupt shutdown may reset the TCP connection before emitting close.
      socket.once("error", (error: NodeJS.ErrnoException) => { errors.push(error); });
    });
    try {
      await resolving;
      await proxy.close();
      await expect(clientClosed).resolves.toBeUndefined();
      expect(errors.map((error) => error.code).filter((code) => code !== "ECONNRESET")).toEqual([]);
      expect(received).not.toContain("200 Connection Established");
    } finally { finishResolution(); }
  });

  it("forces Chrome traffic through the validating proxy without direct fallbacks", () => {
    const flags = lighthouseChromeFlags("http://127.0.0.1:43123");
    expect(flags).toContain("--proxy-server=http://127.0.0.1:43123");
    expect(flags).toContain("--proxy-bypass-list=<-loopback>");
    expect(flags).toContain("--disable-quic");
    expect(flags).toContain(
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    );
    expect(flags).not.toContain("direct://");
  });
});
