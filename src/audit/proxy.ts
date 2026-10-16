import { request as requestHttp, createServer, type IncomingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";

import { networkHostname, pinnedLookup, resolveTargetUrl, type HostResolver } from "./network";

export interface AuditProxy {
  readonly url: string;
  readonly close: () => Promise<void>;
}

const proxyRequestHeaders = (headers: IncomingHttpHeaders, target: URL): IncomingHttpHeaders => {
  const forwarded: IncomingHttpHeaders = { ...headers, host: target.host };
  delete forwarded["proxy-authorization"];
  delete forwarded["proxy-connection"];
  return forwarded;
};

const connectAuthority = (authority: string): URL => {
  const target = new URL(`http://${authority}`);
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error("Invalid proxy CONNECT authority");
  }
  return target;
};

const connectPinned = (
  target: URL,
  addresses: Awaited<ReturnType<typeof resolveTargetUrl>>,
  port: number,
  timeoutMs: number,
  track: (socket: Socket) => void,
): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = connect({
      host: networkHostname(target.hostname),
      port,
      autoSelectFamily: true,
      lookup: pinnedLookup(addresses),
    });
    track(socket);
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("Proxy connection timed out")));
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });

/**
 * Start a loopback-only validating proxy for browser scanners. Every request,
 * including CONNECT and every redirect hop, is DNS-pinned and revalidated.
 */
export const startAuditProxy = async (options: {
  readonly allowPrivate: boolean;
  readonly resolve?: HostResolver;
  readonly timeoutMs?: number;
}): Promise<AuditProxy> => {
  const sockets = new Set<Socket>();
  const timeoutMs = options.timeoutMs ?? 45_000;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.url === undefined) throw new Error("Proxy request URL is missing");
      const target = new URL(request.url);
      if (target.protocol !== "http:") throw new Error("HTTPS proxy requests must use CONNECT");
      const addresses = await resolveTargetUrl(target, options.allowPrivate, options.resolve);
      if (closed || request.destroyed) throw new Error("Audit proxy is closed");
      const upstream = requestHttp({
        hostname: networkHostname(target.hostname),
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: request.method,
        headers: proxyRequestHeaders(request.headers, target),
        agent: false,
        lookup: pinnedLookup(addresses),
      });
      upstream.once("socket", track);
      upstream.setTimeout(timeoutMs, () => upstream.destroy(new Error("Proxy request timed out")));
      upstream.once("response", (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.once("error", (error) => {
        if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
        response.end(error.message);
      });
      request.pipe(upstream);
    } catch (error) {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  server.on("connection", track);
  server.on("connect", async (request, client, head) => {
    try {
      if (request.url === undefined) throw new Error("Proxy CONNECT authority is missing");
      const target = connectAuthority(request.url);
      const port = target.port === "" ? 443 : Number(target.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("Invalid proxy CONNECT port");
      }
      const addresses = await resolveTargetUrl(target, options.allowPrivate, options.resolve);
      if (closed || client.destroyed) throw new Error("Audit proxy is closed");
      const upstream = await connectPinned(target, addresses, port, timeoutMs, track);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.byteLength > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    } catch (error) {
      client.end(
        `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Audit proxy did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      closePromise ??= new Promise<void>((resolve, reject) => {
        closed = true;
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      });
      return closePromise;
    },
  };
};
