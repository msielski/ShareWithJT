import {
  customerLabel,
  jobLabel,
  loadCustomers,
  loadJobs,
  loadOrganization,
  uploadFile,
} from "./jobtread.js";
import { addFiles, clearFiles, listFiles, removeFile } from "./storage.js";

const TOKEN_KEY = "jobtreadGrantKey";

const elements = {
  tokenForm: document.querySelector("#token-form"),
  grantKey: document.querySelector("#grant-key"),
  connectionBadge: document.querySelector("#connection-badge"),
  connectedPanel: document.querySelector("#connected-panel"),
  organizationName: document.querySelector("#organization-name"),
  forgetToken: document.querySelector("#forget-token"),
  connectionStatus: document.querySelector("#connection-status"),
  filePicker: document.querySelector("#file-picker"),
  emptyFiles: document.querySelector("#empty-files"),
  fileSummary: document.querySelector("#file-summary"),
  fileCount: document.querySelector("#file-count"),
  fileList: document.querySelector("#file-list"),
  fileTemplate: document.querySelector("#file-template"),
  clearFiles: document.querySelector("#clear-files"),
  customerInput: document.querySelector("#customer-input"),
  customerOptions: document.querySelector("#customer-options"),
  customerHelp: document.querySelector("#customer-help"),
  jobInput: document.querySelector("#job-input"),
  jobOptions: document.querySelector("#job-options"),
  jobHelp: document.querySelector("#job-help"),
  destination: document.querySelector("#upload-destination"),
  uploadStatus: document.querySelector("#upload-status"),
  uploadButton: document.querySelector("#upload-button"),
  progress: document.querySelector("#upload-progress"),
  progressBar: document.querySelector("#upload-progress-bar"),
  installButton: document.querySelector("#install-button"),
};

const state = {
  grantKey: localStorage.getItem(TOKEN_KEY) || "",
  organization: null,
  customers: [],
  jobs: [],
  files: [],
  customer: null,
  job: null,
  uploading: false,
  previewUrls: [],
  installPrompt: null,
  jobRequest: null,
};

function setStatus(element, message = "", kind = "") {
  element.textContent = message;
  element.className = `status${kind ? ` ${kind}` : ""}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 || value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function selectedByLabel(items, value, labeler) {
  const normalized = value.trim().toLocaleLowerCase();
  return items.find((item) => labeler(item).toLocaleLowerCase() === normalized) ?? null;
}

function fillOptions(datalist, items, labeler) {
  datalist.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement("option");
      option.value = labeler(item);
      return option;
    }),
  );
}

function updateUploadAvailability() {
  const invalidJobText = elements.jobInput.value.trim() && !state.job;
  const canUpload =
    Boolean(state.grantKey && state.organization && state.customer && state.files.length) &&
    !invalidJobText &&
    !state.uploading;
  elements.uploadButton.disabled = !canUpload;

  if (!state.customer) {
    elements.destination.textContent = "Choose a customer to continue.";
  } else if (state.job) {
    elements.destination.textContent = `Upload to job: ${jobLabel(state.job)}`;
  } else if (invalidJobText) {
    elements.destination.textContent = "Choose a job from the suggestions, or clear the Job field.";
  } else {
    elements.destination.textContent = `Upload to ${state.customer.name} customer Files.`;
  }
}

function fileTypeLabel(file) {
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "";
  if (extension && extension.length <= 5) return extension.toUpperCase();
  if (file.type.startsWith("video/")) return "VIDEO";
  if (file.type.startsWith("audio/")) return "AUDIO";
  if (file.type === "application/pdf") return "PDF";
  return "FILE";
}

function renderFiles() {
  for (const url of state.previewUrls) URL.revokeObjectURL(url);
  state.previewUrls = [];
  elements.fileList.replaceChildren();

  elements.emptyFiles.hidden = state.files.length > 0;
  elements.fileSummary.hidden = state.files.length === 0;
  if (state.files.length) {
    const totalSize = state.files.reduce((sum, file) => sum + file.size, 0);
    elements.fileCount.textContent = `${state.files.length} file${state.files.length === 1 ? "" : "s"} · ${formatBytes(totalSize)}`;
  }

  for (const file of state.files) {
    const item = elements.fileTemplate.content.firstElementChild.cloneNode(true);
    const image = item.querySelector(".file-thumbnail");
    const typeIcon = item.querySelector(".file-type-icon");
    if (file.type.startsWith("image/")) {
      const previewUrl = URL.createObjectURL(file.blob);
      state.previewUrls.push(previewUrl);
      image.src = previewUrl;
      image.alt = `Preview of ${file.name}`;
      image.hidden = false;
      typeIcon.hidden = true;
    } else {
      typeIcon.textContent = fileTypeLabel(file);
    }
    item.querySelector(".file-name").textContent = file.name;
    item.querySelector(".file-size").textContent = formatBytes(file.size);
    item.querySelector(".remove-file").addEventListener("click", async () => {
      if (state.uploading) return;
      await removeFile(file.id);
      await refreshFiles();
    });
    elements.fileList.append(item);
  }
  updateUploadAvailability();
}

async function refreshFiles() {
  state.files = await listFiles();
  renderFiles();
}

function resetDestination() {
  state.customer = null;
  state.job = null;
  state.jobs = [];
  elements.customerInput.value = "";
  elements.jobInput.value = "";
  elements.jobInput.disabled = true;
  elements.jobOptions.replaceChildren();
  elements.jobHelp.textContent = "Leave blank to upload to the customer’s Files.";
  updateUploadAvailability();
}

function showDisconnected() {
  elements.tokenForm.hidden = false;
  elements.connectedPanel.hidden = true;
  elements.connectionBadge.hidden = true;
  elements.customerInput.disabled = true;
  elements.customerOptions.replaceChildren();
  elements.customerHelp.textContent = "Connect to JobTread to load customers.";
  resetDestination();
}

async function connect(grantKey, { save = false } = {}) {
  setStatus(elements.connectionStatus, "Connecting to JobTread…");
  elements.tokenForm.querySelector("button").disabled = true;

  try {
    const organization = await loadOrganization(grantKey);
    const customers = await loadCustomers(grantKey, organization.id);
    state.grantKey = grantKey;
    state.organization = organization;
    state.customers = customers;

    if (save) localStorage.setItem(TOKEN_KEY, grantKey);
    fillOptions(elements.customerOptions, customers, (customer) =>
      customerLabel(customer, customers),
    );
    elements.organizationName.textContent = organization.name;
    elements.tokenForm.hidden = true;
    elements.connectedPanel.hidden = false;
    elements.connectionBadge.hidden = false;
    elements.customerInput.disabled = false;
    elements.customerHelp.textContent = `${customers.length} customer${customers.length === 1 ? "" : "s"} available. Type to search.`;
    setStatus(elements.connectionStatus, "Connected successfully.", "success");
  } catch (error) {
    if (save) localStorage.removeItem(TOKEN_KEY);
    state.grantKey = "";
    state.organization = null;
    state.customers = [];
    showDisconnected();
    setStatus(elements.connectionStatus, error.message || "Could not connect to JobTread.", "error");
  } finally {
    elements.tokenForm.querySelector("button").disabled = false;
    updateUploadAvailability();
  }
}

async function selectCustomer() {
  const customer = selectedByLabel(state.customers, elements.customerInput.value, (item) =>
    customerLabel(item, state.customers),
  );

  if (state.customer?.id === customer?.id) return;
  state.customer = customer;
  state.job = null;
  state.jobs = [];
  elements.jobInput.value = "";
  elements.jobOptions.replaceChildren();
  state.jobRequest?.abort();

  if (!customer) {
    elements.jobInput.disabled = true;
    elements.jobHelp.textContent = "Select a customer first.";
    updateUploadAvailability();
    return;
  }

  elements.jobInput.disabled = true;
  elements.jobHelp.textContent = "Loading this customer’s jobs…";
  updateUploadAvailability();
  const controller = new AbortController();
  state.jobRequest = controller;

  try {
    const jobs = await loadJobs(state.grantKey, customer.id, { signal: controller.signal });
    if (state.customer?.id !== customer.id) return;
    state.jobs = jobs;
    fillOptions(elements.jobOptions, jobs, jobLabel);
    elements.jobInput.disabled = false;
    elements.jobHelp.textContent = jobs.length
      ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} available. Leave blank for customer Files.`
      : "This customer has no jobs. Files will go to customer Files.";
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.jobInput.disabled = false;
    elements.jobHelp.textContent = `Could not load jobs: ${error.message}`;
  } finally {
    if (state.jobRequest === controller) state.jobRequest = null;
    updateUploadAvailability();
  }
}

function selectJob() {
  state.job = selectedByLabel(state.jobs, elements.jobInput.value, jobLabel);
  updateUploadAvailability();
}

async function uploadAll() {
  if (state.uploading || !state.customer || !state.files.length) return;
  const invalidJobText = elements.jobInput.value.trim() && !state.job;
  if (invalidJobText) {
    setStatus(elements.uploadStatus, "Choose a job from the suggestions, or clear the Job field.", "error");
    return;
  }

  const target = state.job
    ? { id: state.job.id, type: "job" }
    : { id: state.customer.id, type: "account" };
  const queuedFiles = [...state.files];
  const failures = [];
  state.uploading = true;
  elements.uploadButton.disabled = true;
  elements.customerInput.disabled = true;
  elements.jobInput.disabled = true;
  elements.filePicker.disabled = true;
  elements.clearFiles.disabled = true;
  elements.progress.hidden = false;
  elements.progressBar.style.width = "0%";

  for (const [index, file] of queuedFiles.entries()) {
    setStatus(
      elements.uploadStatus,
      `Uploading ${index + 1} of ${queuedFiles.length}: ${file.name}`,
    );
    try {
      await uploadFile(state.grantKey, state.organization.id, file, target);
      await removeFile(file.id);
    } catch (error) {
      failures.push({ file, error });
    }
    elements.progressBar.style.width = `${((index + 1) / queuedFiles.length) * 100}%`;
  }

  state.uploading = false;
  elements.customerInput.disabled = false;
  elements.jobInput.disabled = !state.customer;
  elements.filePicker.disabled = false;
  elements.clearFiles.disabled = false;
  await refreshFiles();

  if (failures.length) {
    const succeeded = queuedFiles.length - failures.length;
    const firstError = failures[0].error?.message || "Unknown upload error.";
    setStatus(
      elements.uploadStatus,
      `${succeeded} uploaded; ${failures.length} failed and remain queued. ${firstError}`,
      "error",
    );
  } else {
    setStatus(
      elements.uploadStatus,
      `${queuedFiles.length} file${queuedFiles.length === 1 ? "" : "s"} uploaded successfully.`,
      "success",
    );
  }
  updateUploadAvailability();
}

elements.tokenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const grantKey = elements.grantKey.value.trim();
  if (grantKey) await connect(grantKey, { save: true });
});

elements.forgetToken.addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  state.grantKey = "";
  state.organization = null;
  state.customers = [];
  elements.grantKey.value = "";
  setStatus(elements.connectionStatus, "Grant Key removed from this device.");
  showDisconnected();
});

elements.filePicker.addEventListener("change", async () => {
  try {
    await addFiles(elements.filePicker.files);
    await refreshFiles();
    setStatus(elements.uploadStatus);
  } catch (error) {
    setStatus(elements.uploadStatus, `Could not save the selected files: ${error.message}`, "error");
  } finally {
    elements.filePicker.value = "";
  }
});

elements.clearFiles.addEventListener("click", async () => {
  if (state.uploading) return;
  await clearFiles();
  await refreshFiles();
  setStatus(elements.uploadStatus);
});

elements.customerInput.addEventListener("input", selectCustomer);
elements.customerInput.addEventListener("change", selectCustomer);
elements.jobInput.addEventListener("input", selectJob);
elements.jobInput.addEventListener("change", selectJob);
elements.uploadButton.addEventListener("click", uploadAll);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  elements.installButton.hidden = false;
});

elements.installButton.addEventListener("click", async () => {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  elements.installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  elements.installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    setStatus(elements.uploadStatus, `Offline/share support could not start: ${error.message}`, "error");
  });
}

try {
  await refreshFiles();
} catch (error) {
  setStatus(elements.uploadStatus, `Could not read the file queue: ${error.message}`, "error");
}

const launchParams = new URLSearchParams(window.location.search);
if (launchParams.has("shareError")) {
  setStatus(elements.uploadStatus, launchParams.get("shareError"), "error");
} else if (launchParams.has("shared")) {
  setStatus(
    elements.uploadStatus,
    `${state.files.length} shared file${state.files.length === 1 ? " is" : "s are"} ready.`,
    "success",
  );
}
if (launchParams.has("shareError") || launchParams.has("shared")) {
  history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
}

if (state.grantKey) {
  await connect(state.grantKey);
} else {
  showDisconnected();
}
