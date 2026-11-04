#!/usr/bin/env node
/**
 * Smart Table MCP stdio bridge.
 * Env:
 *   SMART_TABLE_URL   e.g. http://127.0.0.1:3000
 *   SMART_TABLE_TOKEN st_agt_... (from POST /agent/tokens)
 *
 * Speaks MCP JSON-RPC over stdin/stdout; forwards tools/* to API POST /mcp.
 */

import { createInterface } from 'node:readline';

const baseUrl = (process.env.SMART_TABLE_URL || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const token = process.env.SMART_TABLE_TOKEN?.trim();

if (!token) {
  process.stderr.write(
    'SMART_TABLE_TOKEN is required (create via POST /agent/tokens)\n',
  );
  process.exit(1);
}

async function rpcToApi(message) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(message),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  if (!res.ok) {
    const msg =
      data?.message || data?.error?.message || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    write({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }

  // notifications have no id — still forward initialize handshake helpers locally
  if (req.method === 'notifications/initialized') {
    return;
  }

  try {
    if (req.method === 'initialize') {
      write({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'smart-table-mcp', version: '0.1.0' },
        },
      });
      return;
    }
    const result = await rpcToApi(req);
    write(result);
  } catch (error) {
    write({
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
