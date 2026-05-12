from __future__ import annotations

import asyncio
import base64
import contextlib
import ipaddress
import logging
from dataclasses import dataclass
from typing import Dict
from urllib.parse import urlsplit


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class UpstreamProxy:
    proxy_id: str
    host: str
    port: int
    proxy_type: str  # http|https|socks5
    username: str | None = None
    password: str | None = None

    @property
    def auth_header_value(self) -> str | None:
        if not self.username:
            return None
        raw = f"{self.username}:{self.password or ''}".encode("utf-8")
        return f"Basic {base64.b64encode(raw).decode('ascii')}"


@dataclass
class BridgeRuntime:
    bridge_id: str
    account_id: str
    emulator_serial: str
    listen_host: str
    listen_port: int
    upstream: UpstreamProxy
    server: asyncio.base_events.Server


class ProxyBridgeManager:
    def __init__(
        self,
        *,
        listen_host: str,
        public_host: str,
        bridge_port_start: int = 19100,
        bridge_port_end: int = 19199,
        connect_timeout_seconds: float = 8.0,
    ) -> None:
        self.listen_host = listen_host
        self.public_host = public_host
        self.bridge_port_start = bridge_port_start
        self.bridge_port_end = bridge_port_end
        self.connect_timeout_seconds = connect_timeout_seconds
        self._bridges: Dict[str, BridgeRuntime] = {}
        self._port_by_bridge_id: Dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        async with self._lock:
            bridges = list(self._bridges.values())
            self._bridges.clear()
        for bridge in bridges:
            bridge.server.close()
            await bridge.server.wait_closed()

    async def ensure_bridge(
        self,
        *,
        account_id: str,
        emulator_serial: str,
        upstream: UpstreamProxy,
    ) -> BridgeRuntime:
        bridge_id = f"{account_id}:{emulator_serial}"
        async with self._lock:
            existing = self._bridges.get(bridge_id)
            if existing and existing.upstream == upstream:
                return existing

            if existing:
                existing.server.close()
                await existing.server.wait_closed()
                del self._bridges[bridge_id]

            port = self._resolve_port(bridge_id)
            server = await asyncio.start_server(
                lambda r, w: self._handle_client(upstream, r, w),
                host=self.listen_host,
                port=port,
            )
            runtime = BridgeRuntime(
                bridge_id=bridge_id,
                account_id=account_id,
                emulator_serial=emulator_serial,
                listen_host=self.listen_host,
                listen_port=port,
                upstream=upstream,
                server=server,
            )
            self._bridges[bridge_id] = runtime
            logger.info(
                "proxy_bridge_ready bridge_id=%s emulator_serial=%s listen=%s:%s upstream=%s:%s type=%s",
                bridge_id,
                emulator_serial,
                self.public_host,
                port,
                upstream.host,
                upstream.port,
                upstream.proxy_type,
            )
            return runtime

    async def health_check(self, bridge_id: str) -> bool:
        bridge = self._bridges.get(bridge_id)
        if bridge is None:
            return False
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.listen_host, bridge.listen_port),
                timeout=self.connect_timeout_seconds,
            )
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            return reader is not None
        except Exception:
            return False

    async def _handle_client(
        self,
        upstream: UpstreamProxy,
        client_reader: asyncio.StreamReader,
        client_writer: asyncio.StreamWriter,
    ) -> None:
        try:
            request_head = await asyncio.wait_for(
                client_reader.readuntil(b"\r\n\r\n"),
                timeout=self.connect_timeout_seconds,
            )
        except Exception:
            self._safe_close(client_writer)
            return

        try:
            header_text = request_head.decode("latin-1")
            lines = header_text.split("\r\n")
            if not lines or len(lines[0].split(" ")) < 3:
                await self._send_simple_error(client_writer, 400, "Bad Request")
                return
            method, target, version = lines[0].split(" ", 2)
            method_u = method.upper()
            if method_u == "CONNECT":
                await self._handle_connect_tunnel(upstream, target, client_reader, client_writer, version)
            else:
                await self._handle_http_forward(
                    upstream, method_u, target, version, lines[1:], request_head, client_reader, client_writer
                )
        except Exception:
            logger.exception("proxy_bridge_client_error")
            self._safe_close(client_writer)

    async def _handle_connect_tunnel(
        self,
        upstream: UpstreamProxy,
        target: str,
        client_reader: asyncio.StreamReader,
        client_writer: asyncio.StreamWriter,
        version: str,
    ) -> None:
        host, port = _split_host_port(target, 443)
        if upstream.proxy_type in {"http", "https"}:
            upstream_reader, upstream_writer = await self._open_tcp(upstream.host, upstream.port)
            connect_req = [f"CONNECT {host}:{port} HTTP/1.1", f"Host: {host}:{port}"]
            if upstream.auth_header_value:
                connect_req.append(f"Proxy-Authorization: {upstream.auth_header_value}")
            connect_req.extend(["Proxy-Connection: Keep-Alive", "", ""])
            upstream_writer.write("\r\n".join(connect_req).encode("latin-1"))
            await upstream_writer.drain()
            response = await upstream_reader.readuntil(b"\r\n\r\n")
            if b" 200 " not in response[:32]:
                await self._send_simple_error(client_writer, 502, "Upstream CONNECT failed")
                self._safe_close(upstream_writer)
                return
        elif upstream.proxy_type == "socks5":
            upstream_reader, upstream_writer = await self._open_socks5_tunnel(upstream, host, port)
        else:
            await self._send_simple_error(client_writer, 502, "Unsupported upstream proxy_type")
            return

        client_writer.write(f"{version} 200 Connection established\r\n\r\n".encode("latin-1"))
        await client_writer.drain()
        await self._pipe_bidirectional(client_reader, client_writer, upstream_reader, upstream_writer)

    async def _handle_http_forward(
        self,
        upstream: UpstreamProxy,
        method: str,
        target: str,
        version: str,
        header_lines: list[str],
        request_head: bytes,
        client_reader: asyncio.StreamReader,
        client_writer: asyncio.StreamWriter,
    ) -> None:
        # Emulator sends proxy-form URLs; keep proxy semantics through upstream.
        content_length = _extract_content_length(header_lines)
        body = b""
        if content_length > 0:
            body = await client_reader.readexactly(content_length)

        if upstream.proxy_type in {"http", "https"}:
            upstream_reader, upstream_writer = await self._open_tcp(upstream.host, upstream.port)
            rewritten = _inject_proxy_auth_header(request_head, upstream.auth_header_value)
            upstream_writer.write(rewritten + body)
            await upstream_writer.drain()
            await self._relay_response(upstream_reader, upstream_writer, client_writer)
            return

        if upstream.proxy_type == "socks5":
            # Convert absolute target URL into origin-form request over SOCKS tunnel.
            parsed = urlsplit(target)
            dest_host = parsed.hostname
            if not dest_host:
                await self._send_simple_error(client_writer, 400, "Invalid URL target")
                return
            dest_port = parsed.port or (443 if parsed.scheme == "https" else 80)
            path = parsed.path or "/"
            if parsed.query:
                path += f"?{parsed.query}"
            upstream_reader, upstream_writer = await self._open_socks5_tunnel(upstream, dest_host, dest_port)
            rewritten_head = _rewrite_absolute_request_to_origin_form(
                request_head=request_head,
                method=method,
                path=path,
                version=version,
                host_header=f"{dest_host}:{dest_port}" if parsed.port else dest_host,
            )
            upstream_writer.write(rewritten_head + body)
            await upstream_writer.drain()
            await self._relay_response(upstream_reader, upstream_writer, client_writer)
            return

        await self._send_simple_error(client_writer, 502, "Unsupported upstream proxy_type")

    async def _relay_response(
        self,
        upstream_reader: asyncio.StreamReader,
        upstream_writer: asyncio.StreamWriter,
        client_writer: asyncio.StreamWriter,
    ) -> None:
        try:
            while True:
                chunk = await upstream_reader.read(64 * 1024)
                if not chunk:
                    break
                client_writer.write(chunk)
                await client_writer.drain()
        finally:
            self._safe_close(upstream_writer)
            self._safe_close(client_writer)

    async def _pipe_bidirectional(
        self,
        client_reader: asyncio.StreamReader,
        client_writer: asyncio.StreamWriter,
        upstream_reader: asyncio.StreamReader,
        upstream_writer: asyncio.StreamWriter,
    ) -> None:
        async def _copy(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
            try:
                while True:
                    chunk = await src.read(64 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
                    await dst.drain()
            except Exception:
                pass
            finally:
                self._safe_close(dst)

        await asyncio.gather(
            _copy(client_reader, upstream_writer),
            _copy(upstream_reader, client_writer),
        )

    async def _open_tcp(self, host: str, port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        return await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=self.connect_timeout_seconds,
        )

    async def _open_socks5_tunnel(
        self, upstream: UpstreamProxy, target_host: str, target_port: int
    ) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        reader, writer = await self._open_tcp(upstream.host, upstream.port)
        use_auth = bool(upstream.username)
        methods = b"\x00\x02" if use_auth else b"\x00"
        writer.write(b"\x05" + bytes([len(methods)]) + methods)
        await writer.drain()
        hello = await reader.readexactly(2)
        if hello[0] != 0x05:
            raise RuntimeError("Invalid SOCKS5 handshake response")
        chosen = hello[1]
        if chosen == 0xFF:
            raise RuntimeError("SOCKS5 auth method rejected")
        if chosen == 0x02:
            user = (upstream.username or "").encode("utf-8")
            pwd = (upstream.password or "").encode("utf-8")
            writer.write(b"\x01" + bytes([len(user)]) + user + bytes([len(pwd)]) + pwd)
            await writer.drain()
            auth_resp = await reader.readexactly(2)
            if auth_resp[1] != 0x00:
                raise RuntimeError("SOCKS5 username/password rejected")
        elif chosen != 0x00:
            raise RuntimeError("SOCKS5 unsupported auth negotiation")

        atyp, addr = _socks_addr(target_host)
        req = b"\x05\x01\x00" + bytes([atyp]) + addr + target_port.to_bytes(2, "big")
        writer.write(req)
        await writer.drain()
        resp = await reader.readexactly(4)
        if resp[1] != 0x00:
            raise RuntimeError(f"SOCKS5 connect failed code={resp[1]}")
        await _consume_socks_bound_addr(reader, resp[3])
        return reader, writer

    async def _send_simple_error(self, writer: asyncio.StreamWriter, code: int, reason: str) -> None:
        body = f"{code} {reason}\n".encode("utf-8")
        writer.write(
            f"HTTP/1.1 {code} {reason}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode("latin-1")
            + body
        )
        await writer.drain()
        self._safe_close(writer)

    def _resolve_port(self, bridge_id: str) -> int:
        pinned = self._port_by_bridge_id.get(bridge_id)
        if pinned is not None:
            return pinned
        used = {r.listen_port for r in self._bridges.values()}
        for port in range(self.bridge_port_start, self.bridge_port_end + 1):
            if port not in used:
                self._port_by_bridge_id[bridge_id] = port
                return port
        raise RuntimeError("No free bridge ports available")

    @staticmethod
    def _safe_close(writer: asyncio.StreamWriter) -> None:
        if writer.is_closing():
            return
        writer.close()


def _split_host_port(target: str, default_port: int) -> tuple[str, int]:
    if ":" in target and not target.endswith("]"):
        host, port_s = target.rsplit(":", 1)
        with contextlib.suppress(ValueError):
            return host.strip("[]"), int(port_s)
    return target.strip("[]"), default_port


def _extract_content_length(header_lines: list[str]) -> int:
    for line in header_lines:
        if line.lower().startswith("content-length:"):
            with contextlib.suppress(ValueError):
                return int(line.split(":", 1)[1].strip())
    return 0


def _inject_proxy_auth_header(request_head: bytes, value: str | None) -> bytes:
    if not value:
        return request_head
    text = request_head.decode("latin-1")
    lines = text.split("\r\n")
    out = []
    inserted = False
    for line in lines:
        if not line:
            if not inserted:
                out.append(f"Proxy-Authorization: {value}")
                inserted = True
            out.append("")
            continue
        if line.lower().startswith("proxy-authorization:"):
            if not inserted:
                out.append(f"Proxy-Authorization: {value}")
                inserted = True
            continue
        out.append(line)
    return "\r\n".join(out).encode("latin-1")


def _rewrite_absolute_request_to_origin_form(
    *,
    request_head: bytes,
    method: str,
    path: str,
    version: str,
    host_header: str,
) -> bytes:
    text = request_head.decode("latin-1")
    lines = text.split("\r\n")
    rebuilt = [f"{method} {path} {version}"]
    host_seen = False
    for line in lines[1:]:
        if not line:
            continue
        k = line.split(":", 1)[0].lower()
        if k == "proxy-authorization":
            continue
        if k == "host":
            host_seen = True
            rebuilt.append(f"Host: {host_header}")
        else:
            rebuilt.append(line)
    if not host_seen:
        rebuilt.append(f"Host: {host_header}")
    rebuilt.extend(["", ""])
    return "\r\n".join(rebuilt).encode("latin-1")


def _socks_addr(host: str) -> tuple[int, bytes]:
    with contextlib.suppress(ValueError):
        ip = ipaddress.ip_address(host)
        if ip.version == 4:
            return 0x01, ip.packed
        return 0x04, ip.packed
    encoded = host.encode("idna")
    if len(encoded) > 255:
        raise RuntimeError("SOCKS5 hostname too long")
    return 0x03, bytes([len(encoded)]) + encoded


async def _consume_socks_bound_addr(reader: asyncio.StreamReader, atyp: int) -> None:
    if atyp == 0x01:
        await reader.readexactly(4 + 2)
    elif atyp == 0x04:
        await reader.readexactly(16 + 2)
    elif atyp == 0x03:
        n = await reader.readexactly(1)
        await reader.readexactly(n[0] + 2)
    else:
        raise RuntimeError("SOCKS5 invalid atyp")
