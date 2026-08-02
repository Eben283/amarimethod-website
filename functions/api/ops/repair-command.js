// Protected command bridge for the local Codex repair runner.
// SMS will later feed this through a separately authenticated ingress; do not
// expose this service-key route to a browser or GHL workflow.

import { requireOpsReadKey } from "../../lib/ops-auth.js";
import { authorizeRepairCommand, claimNextRepairCommand, createRepairCommand, finishRepairCommand, getRepairCommand } from "../../lib/ops-repair-command.js";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function onRequestGet(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const result = await getRepairCommand(context.env, id);
    return json(result, result.ok ? 200 : 404);
  }
  if (url.searchParams.get("claim") !== "1") return json({ error: "claim=1 required" }, 400);
  const result = await claimNextRepairCommand(context.env, { runnerId: url.searchParams.get("runner") || "local-codex" });
  return json(result, result.ok ? 200 : 500);
}

export async function onRequestPost(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;
  let body;
  try { body = await context.request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (body.action === "finish") {
    const result = await finishRepairCommand(context.env, body.id, { status: body.status, result: body.result });
    return json(result, result.ok ? 200 : 400);
  }
  if (body.action === "authorize") {
    const result = await authorizeRepairCommand(context.env, body.id, { command: body.command, requestedBy: body.requestedBy });
    return json(result, result.ok ? 201 : 400);
  }
  const result = await createRepairCommand(context.env, body);
  return json(result, result.ok ? 201 : 400);
}
