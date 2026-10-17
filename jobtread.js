export const API_URL = "https://api.jobtread.com/pave";

function describeApiError(payload, response) {
  const candidates = [
    typeof payload === "string" ? payload : undefined,
    payload?.error?.message,
    payload?.error,
    payload?.errors?.[0]?.message,
    payload?.errors?.[0],
    payload?.message,
  ];
  const detail = candidates.find((value) => typeof value === "string" && value.trim());
  return detail || `JobTread request failed (${response.status} ${response.statusText}).`;
}

export async function pave(grantKey, fields, { signal } = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...fields } }),
    signal,
  });

  const rawBody = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    if (!response.ok) {
      throw new Error(rawBody.trim() || `JobTread request failed (${response.status}).`);
    }
    throw new Error(`JobTread returned an unreadable response (${response.status}).`);
  }

  if (!response.ok || payload?.error || payload?.errors?.length) {
    throw new Error(describeApiError(payload, response));
  }

  return payload?.data ?? payload;
}

export function organizationQuery() {
  return {
    currentGrant: {
      organization: { id: {}, name: {} },
    },
  };
}

export function customersQuery(organizationId, page) {
  return {
    organization: {
      $: { id: organizationId },
      accounts: {
        $: {
          size: 100,
          ...(page ? { page } : {}),
          where: { and: [["type", "customer"], ["archivedAt", null]] },
          sortBy: [{ field: "name" }],
        },
        nodes: { id: {}, name: {}, type: {} },
        nextPage: {},
      },
    },
  };
}

export function jobsQuery(accountId, page) {
  return {
    account: {
      $: { id: accountId },
      jobs: {
        $: {
          size: 100,
          ...(page ? { page } : {}),
          sortBy: [{ field: "name" }],
        },
        nodes: { id: {}, name: {}, number: {}, closedOn: {} },
        nextPage: {},
      },
    },
  };
}

export function createUploadRequestQuery(organizationId, file) {
  return {
    createUploadRequest: {
      $: {
        organizationId,
        size: file.size,
        type: file.type || { fromName: file.name },
      },
      createdUploadRequest: {
        id: {},
        url: {},
        method: {},
        headers: {},
      },
    },
  };
}

export function createFileQuery(uploadRequestId, fileName, target) {
  return {
    createFile: {
      $: {
        uploadRequestId,
        name: fileName,
        targetId: target.id,
        targetType: target.type,
      },
      createdFile: { id: {}, name: {} },
    },
  };
}

export async function loadOrganization(grantKey, options) {
  const data = await pave(grantKey, organizationQuery(), options);
  const organization = data?.currentGrant?.organization;
  if (!organization?.id) {
    throw new Error("This Grant Key is not connected to a JobTread organization.");
  }
  return organization;
}

export async function loadCustomers(grantKey, organizationId, options) {
  const customers = [];
  let page;

  do {
    const data = await pave(grantKey, customersQuery(organizationId, page), options);
    const connection = data?.organization?.accounts;
    customers.push(...(connection?.nodes ?? []));
    page = connection?.nextPage || undefined;
  } while (page);

  return customers;
}

export async function loadJobs(grantKey, accountId, options) {
  const jobs = [];
  let page;

  do {
    const data = await pave(grantKey, jobsQuery(accountId, page), options);
    const connection = data?.account?.jobs;
    jobs.push(...(connection?.nodes ?? []));
    page = connection?.nextPage || undefined;
  } while (page);

  return jobs;
}

export async function uploadFile(grantKey, organizationId, file, target, options = {}) {
  const uploadData = await pave(
    grantKey,
    createUploadRequestQuery(organizationId, file),
    options,
  );
  const uploadRequest = uploadData?.createUploadRequest?.createdUploadRequest;
  if (!uploadRequest?.id || !uploadRequest?.url) {
    throw new Error("JobTread did not return an upload URL.");
  }

  const uploadResponse = await fetch(uploadRequest.url, {
    method: uploadRequest.method || "PUT",
    headers: uploadRequest.headers || {},
    body: file.blob,
    signal: options.signal,
  });
  if (!uploadResponse.ok) {
    throw new Error(`File transfer failed (${uploadResponse.status} ${uploadResponse.statusText}).`);
  }

  const fileData = await pave(
    grantKey,
    createFileQuery(uploadRequest.id, file.name, target),
    options,
  );
  const createdFile = fileData?.createFile?.createdFile;
  if (!createdFile?.id) {
    throw new Error("The file transferred, but JobTread did not attach it to the destination.");
  }
  return createdFile;
}

export function customerLabel(customer, allCustomers = []) {
  const duplicate = allCustomers.some(
    (other) => other.id !== customer.id && other.name.trim() === customer.name.trim(),
  );
  return duplicate ? `${customer.name} · ${customer.id.slice(-6)}` : customer.name;
}

export function jobLabel(job) {
  const details = [job.number ? `#${job.number}` : "", job.closedOn ? "Closed" : ""].filter(Boolean);
  return details.length ? `${job.name} · ${details.join(" · ")}` : job.name;
}
