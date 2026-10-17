import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createFileQuery,
  createUploadRequestQuery,
  customerLabel,
  customersQuery,
  jobLabel,
  jobsQuery,
  organizationQuery,
  pave,
} from "../jobtread.js";

test("organization query asks for the Grant Key organization", () => {
  assert.deepEqual(organizationQuery(), {
    currentGrant: { organization: { id: {}, name: {} } },
  });
});

test("customer query filters to unarchived customers and paginates", () => {
  const query = customersQuery("org_123", "next-token");
  const args = query.organization.accounts.$;

  assert.equal(query.organization.$.id, "org_123");
  assert.equal(args.page, "next-token");
  assert.deepEqual(args.where, {
    and: [["type", "customer"], ["archivedAt", null]],
  });
  assert.deepEqual(query.organization.accounts.nodes, { id: {}, name: {}, type: {} });
});

test("jobs query scopes jobs to the selected customer account", () => {
  const query = jobsQuery("account_123");

  assert.equal(query.account.$.id, "account_123");
  assert.equal(query.account.jobs.$.page, undefined);
  assert.deepEqual(query.account.jobs.nodes, {
    id: {},
    name: {},
    number: {},
    closedOn: {},
  });
});

test("upload request uses the MIME type when Android supplies one", () => {
  const query = createUploadRequestQuery("org_123", {
    name: "site.jpg",
    type: "image/jpeg",
    size: 2048,
  });

  assert.deepEqual(query.createUploadRequest.$, {
    organizationId: "org_123",
    size: 2048,
    type: "image/jpeg",
  });
});

test("upload request infers type from the file name when MIME type is missing", () => {
  const query = createUploadRequestQuery("org_123", {
    name: "site.heic",
    type: "",
    size: 2048,
  });

  assert.deepEqual(query.createUploadRequest.$.type, { fromName: "site.heic" });
});

test("createFile can target a customer account or job", () => {
  const accountQuery = createFileQuery("upload_123", "site.jpg", {
    id: "account_123",
    type: "account",
  });
  const jobQuery = createFileQuery("upload_123", "site.jpg", {
    id: "job_123",
    type: "job",
  });

  assert.equal(accountQuery.createFile.$.targetType, "account");
  assert.equal(accountQuery.createFile.$.targetId, "account_123");
  assert.equal(jobQuery.createFile.$.targetType, "job");
  assert.equal(jobQuery.createFile.$.targetId, "job_123");
});

test("duplicate customer labels remain selectable", () => {
  const customers = [
    { id: "account_abcdef", name: "Acme" },
    { id: "account_uvwxyz", name: "Acme" },
  ];

  assert.equal(customerLabel(customers[0], customers), "Acme · abcdef");
  assert.equal(customerLabel(customers[1], customers), "Acme · uvwxyz");
});

test("job labels include useful number and closed-state context", () => {
  assert.equal(jobLabel({ name: "Kitchen", number: "42", closedOn: null }), "Kitchen · #42");
  assert.equal(
    jobLabel({ name: "Kitchen", number: "42", closedOn: "2026-01-01" }),
    "Kitchen · #42 · Closed",
  );
});

test("manifest declares a general file POST share target", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"),
  );

  assert.equal(manifest.share_target.method, "POST");
  assert.equal(manifest.share_target.enctype, "multipart/form-data");
  assert.equal(manifest.share_target.params.files[0].name, "files");
  assert.ok(manifest.share_target.params.files[0].accept.includes("image/*"));
  assert.ok(manifest.share_target.params.files[0].accept.includes("video/*"));
  assert.ok(manifest.share_target.params.files[0].accept.includes("audio/*"));
  assert.ok(manifest.share_target.params.files[0].accept.includes("application/pdf"));
  assert.ok(manifest.share_target.params.files[0].accept.includes("text/plain"));
  assert.ok(
    manifest.share_target.params.files[0].accept.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  );
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
});

test("Pave surfaces JobTread plain-text errors", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response("Supplied key is invalid or expired", {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "text/plain" },
    });

  await assert.rejects(
    pave("bad-key", organizationQuery()),
    /Supplied key is invalid or expired/,
  );
});

test("Pave unwraps successful data responses", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({ data: { currentGrant: { organization: { id: "org_123" } } } });

  const result = await pave("valid-key", organizationQuery());
  assert.equal(result.currentGrant.organization.id, "org_123");
});
