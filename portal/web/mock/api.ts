import { randomUUID } from "node:crypto";
import { seedData, seedTenant, type Row } from "./data.ts";

const roles = ["owner", "admin", "member", "viewer"];
const scenarios = ["normal", "empty", "error", "slow"];
const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(body, { status, headers });

// This is a UI fixture, never an authentication or telephony implementation.
export function createMockApi() {
  let tables = seedData();
  let tenant: Row = seedTenant();
  let role = "owner";
  let scenario = "normal";
  const org = {
    id: "demo-org",
    name: "Northstar Office",
    slug: "northstar",
    createdAt: new Date().toISOString(),
    logo: null,
  };
  const visible = (name: string) => tables[name] ?? [];
  function audit(
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    tables.audit.unshift({
      id: randomUUID(),
      action,
      entityType,
      entityId,
      before,
      after,
      userId: `demo-${role}`,
      userEmail: `${role}@example.test`,
      ipAddress: "127.0.0.1",
      createdAt: new Date().toISOString(),
    });
  }
  function filtered(name: "cdr" | "audit", params: URLSearchParams) {
    return visible(name).filter((row) => {
      for (const key of [
        "direction",
        "extensionId",
        "entityType",
        "action",
        "userId",
      ]) {
        if (params.get(key) && row[key] !== params.get(key)) return false;
      }
      if (
        params.get("number") &&
        !`${row.callerNumber} ${row.destinationNumber}`.includes(
          params.get("number")!,
        )
      )
        return false;
      if (
        params.get("answered") &&
        Boolean(row.answeredAt) !== (params.get("answered") === "true")
      )
        return false;
      const date = String(row.startedAt ?? row.createdAt).slice(0, 10);
      return (
        (!params.get("from") || date >= params.get("from")!) &&
        (!params.get("to") || date <= params.get("to")!)
      );
    });
  }
  function page(rows: Row[], params: URLSearchParams) {
    const limit = Math.min(250, Math.max(1, Number(params.get("limit")) || 50));
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    return {
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      limit,
      offset,
    };
  }
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    const method = request.method;
    let body: Row = {};
    if (method !== "GET" && method !== "HEAD") {
      try {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
        if (!body || Array.isArray(body) || typeof body !== "object")
          throw new Error("Invalid body");
      } catch {
        return json({ error: "Expected JSON object" }, 400);
      }
    }
    if (path === "/__mock/state") return json({ role, scenario });
    if (path === "/__mock/settings" && method === "POST") {
      if (typeof body.role === "string" && roles.includes(body.role))
        role = body.role;
      if (
        typeof body.scenario === "string" &&
        scenarios.includes(body.scenario)
      ) {
        if (body.scenario === "empty" && scenario !== "empty")
          tables = Object.fromEntries(
            Object.keys(tables).map((name) => [name, []]),
          );
        else if (scenario === "empty" && body.scenario !== "empty")
          tables = seedData();
        scenario = body.scenario;
      }
      return json({ role, scenario });
    }
    if (path === "/__mock/reset" && method === "POST") {
      tables = seedData();
      tenant = seedTenant();
      scenario = "normal";
      role = "owner";
      return json({ ok: true }, 200, {
        "Set-Cookie":
          "qwixbox_mock_signed_out=; Path=/; Max-Age=0; SameSite=Lax",
      });
    }
    const signedOut = request.headers
      .get("cookie")
      ?.includes("qwixbox_mock_signed_out=1");
    const person = tables.members.find((member) => member.role === role)
      ?.user as Row | undefined;
    const user = {
      id: `demo-${role}`,
      name: person?.name ?? "Demo User",
      email: `${role}@example.test`,
      emailVerified: true,
      image: null,
      createdAt: org.createdAt,
      updatedAt: org.createdAt,
    };
    const session = {
      id: `demo-session-${role}`,
      token: "synthetic-demo-session",
      userId: user.id,
      activeOrganizationId: org.id,
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      createdAt: org.createdAt,
      updatedAt: org.createdAt,
    };
    if (path === "/api/auth/get-session")
      return json(signedOut ? null : { user, session });
    if (path === "/api/auth/sign-in/email" && method === "POST")
      return json({ user, token: session.token, redirect: false }, 200, {
        "Set-Cookie":
          "qwixbox_mock_signed_out=; Path=/; Max-Age=0; SameSite=Lax",
      });
    if (path === "/api/auth/sign-out")
      return json({ success: true }, 200, {
        "Set-Cookie": "qwixbox_mock_signed_out=1; Path=/; SameSite=Lax",
      });
    if (path === "/health")
      return json({
        status: scenario === "error" ? "degraded" : "ok",
        database: scenario !== "error",
        redis: scenario !== "error",
        freeswitch: scenario !== "error",
      });
    if (signedOut) return json({ error: "Sign in to the mock portal" }, 401);
    if (path === "/api/auth/organization/get-active-member-role")
      return json({ role });
    if (path === "/api/auth/organization/list") return json([org]);
    if (path === "/api/auth/organization/set-active") return json(org);
    if (path === "/api/auth/organization/get-full-organization")
      return json({ ...org, members: tables.members, invitations: [] });
    if (path === "/api/auth/organization/list-members")
      return json({
        members: visible("members"),
        total: visible("members").length,
      });
    if (path.startsWith("/api/auth/"))
      return json(
        { error: "This account action is unavailable in the local mock" },
        501,
      );
    if (scenario === "slow")
      await new Promise((resolve) => setTimeout(resolve, 2500));
    if (scenario === "error")
      return json(
        {
          error:
            "Simulated API outage. Choose Normal in the mock controls to recover.",
        },
        503,
      );
    const [, , resource, id, child, childId] = path
      .split("/")
      .map(decodeURIComponent);
    const write = !["GET", "HEAD"].includes(method);
    if (
      (role === "viewer" && write) ||
      (role === "member" &&
        write &&
        ["trunks", "inbound-routes", "outbound-routes", "tenant"].includes(
          resource,
        ))
    )
      return json(
        { error: "This action is not allowed for the selected demo role" },
        403,
      );
    if (
      (resource === "audit" && !["owner", "admin"].includes(role)) ||
      (resource === "faxes" && role === "viewer") ||
      (resource === "cdr" &&
        id === "export" &&
        !["owner", "admin"].includes(role))
    )
      return json({ error: "Not allowed for this demo role" }, 403);
    if (resource === "tenant") {
      if (id === "rebuild-cache") return json({ status: "rebuilt" });
      if (id === "members") {
        const memberId = child;
        const member = tables.members.find((row) => row.id === memberId);
        if (method === "POST") {
          if (!body.email) return json({ error: "email is required" }, 400);
          if (body.role === "owner" && role !== "owner")
            return json({ error: "Only owners may grant owner" }, 403);
          const row = {
            id: randomUUID(),
            userId: randomUUID(),
            role: body.role ?? "member",
            organizationId: org.id,
            createdAt: new Date().toISOString(),
            user: { email: body.email, name: "Demo member" },
          };
          tables.members.push(row);
          audit("create", "member", row.id, null, row);
          return json({ ...row, email: body.email, status: "created" }, 201);
        }
        if (!member) return json({ error: "Member not found" }, 404);
        if (
          (member.role === "owner" || body.role === "owner") &&
          role !== "owner"
        )
          return json({ error: "Only owners may change owners" }, 403);
        if (
          member.role === "owner" &&
          tables.members.filter((row) => row.role === "owner").length === 1 &&
          (method === "DELETE" || body.role !== "owner")
        )
          return json({ error: "Keep at least one owner" }, 409);
        if (method === "DELETE") {
          tables.members = tables.members.filter((row) => row !== member);
          return new Response(null, { status: 204 });
        }
        Object.assign(member, { role: body.role });
        return json(member);
      }
      if (write) {
        const before = { ...tenant };
        tenant = { ...tenant, ...body };
        audit("update", "tenant_settings", org.id, before, tenant);
      }
      return json(tenant);
    }
    if (resource === "cdr" || resource === "audit") {
      const rows = filtered(resource, url.searchParams);
      if (resource === "cdr" && id === "summary") {
        const answered = rows.filter((row) => row.answeredAt).length;
        return json({
          calls: rows.length,
          answered,
          answerRate: rows.length ? answered / rows.length : null,
          inbound: rows.filter((row) => row.direction === "inbound").length,
          outbound: rows.filter((row) => row.direction === "outbound").length,
          internal: rows.filter((row) => row.direction === "internal").length,
          billableSec: rows.reduce(
            (sum, row) => sum + Number(row.billsecSec),
            0,
          ),
        });
      }
      if (resource === "cdr" && id === "export")
        return new Response(
          [
            "Direction,Caller,Destination,Seconds",
            ...rows.map((row) =>
              [
                row.direction,
                row.callerNumber,
                row.destinationNumber,
                row.billsecSec,
              ]
                .map((value) => JSON.stringify(String(value ?? "")))
                .join(","),
            ),
          ].join("\n"),
          {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": 'attachment; filename="mock-calls.csv"',
            },
          },
        );
      return json(page(rows, url.searchParams));
    }
    if (resource === "faxes" && child === "download")
      return new Response(
        "Synthetic mock fax. No customer document or live fax service is connected.\n",
        {
          headers: {
            "Content-Type": "text/plain",
            "Content-Disposition": 'attachment; filename="mock-fax.txt"',
          },
        },
      );
    if (
      !Object.hasOwn(tables, resource) ||
      ["members", "ring-group-members", "ivr-options"].includes(resource)
    )
      return json({ error: "Mock endpoint not implemented" }, 404);
    if (child === "members" && resource === "ring-groups") {
      if (method === "POST") {
        if (!tables.extensions.some((row) => row.id === body.extensionId))
          return json({ error: "Extension not found" }, 400);
        const row = {
          id: randomUUID(),
          ringGroupId: id,
          extensionId: body.extensionId,
          delaySec: body.delaySec ?? 0,
          position: tables["ring-group-members"].length,
        };
        tables["ring-group-members"].push(row);
        return json(row, 201);
      }
      if (method === "DELETE") {
        tables["ring-group-members"] = tables["ring-group-members"].filter(
          (row) => !(row.ringGroupId === id && row.id === childId),
        );
        return new Response(null, { status: 204 });
      }
      return json(
        visible("ring-group-members")
          .filter((row) => row.ringGroupId === id)
          .map((row) => {
            const ext = tables.extensions.find(
              (ext) => ext.id === row.extensionId,
            );
            return {
              ...row,
              number: ext?.number,
              displayName: ext?.displayName,
            };
          }),
      );
    }
    if (child === "options" && resource === "ivr-menus") {
      if (method === "PUT") {
        const row = {
          ...body,
          id: randomUUID(),
          ivrMenuId: id,
          digit: childId,
        };
        tables["ivr-options"] = tables["ivr-options"].filter(
          (option) => !(option.ivrMenuId === id && option.digit === childId),
        );
        tables["ivr-options"].push(row);
        return json(row);
      }
      if (method === "DELETE") {
        tables["ivr-options"] = tables["ivr-options"].filter(
          (row) => !(row.ivrMenuId === id && row.digit === childId),
        );
        return new Response(null, { status: 204 });
      }
      return json(visible("ivr-options").filter((row) => row.ivrMenuId === id));
    }
    if (resource === "trunks" && child === "password")
      return json({ status: "updated" });
    if (method === "POST" && !id) {
      if (
        body.number &&
        tables[resource].some((row) => row.number === body.number)
      )
        return json({ error: "Number already exists" }, 409);
      if (
        body.didPattern &&
        tables[resource].some((row) => row.didPattern === body.didPattern)
      )
        return json({ error: "DID is already assigned" }, 409);
      const defaults =
        resource === "extensions"
          ? {
              voicemailEnabled: true,
              voicemailEmail: null,
              callerIdName: null,
              callerIdNumber: null,
              codecPrefs: null,
              maxConcurrentCalls: null,
              deviceMac: null,
              dnd: false,
              forwardAllTo: null,
              forwardBusyTo: null,
              forwardNoAnswerTo: null,
              ringTimeoutSec: 25,
              callWaitingEnabled: true,
            }
          : {};
      const row = {
        ...defaults,
        ...body,
        id: randomUUID(),
        organizationId: org.id,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      tables[resource].push(row);
      audit("create", resource, row.id, null, row);
      return json(
        resource === "extensions"
          ? {
              ...row,
              sipPassword: "demo-only-sip-password",
              voicemailPin: "1234",
            }
          : row,
        201,
      );
    }
    const row = tables[resource].find((row) => row.id === id);
    if (id && !row) return json({ error: "Not found" }, 404);
    if (method === "PATCH" && row) {
      const before = { ...row };
      Object.assign(row, body, { updatedAt: new Date().toISOString() });
      audit("update", resource, id, before, row);
      return json(row);
    }
    if (method === "DELETE" && row) {
      tables[resource] = tables[resource].filter((item) => item.id !== id);
      audit("delete", resource, id, row, null);
      return new Response(null, { status: 204 });
    }
    if (method === "GET") return json(id ? row : visible(resource));
    return json({ error: "Mock action unavailable" }, 405);
  };
}
