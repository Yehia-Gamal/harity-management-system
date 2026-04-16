const form = document.getElementById("simulatorForm");
const payloadPreview = document.getElementById("payloadPreview");
const resultBadge = document.getElementById("resultBadge");
const resultTitle = document.getElementById("resultTitle");
const resultDescription = document.getElementById("resultDescription");
const verificationValue = document.getElementById("verificationValue");
const geofenceValue = document.getElementById("geofenceValue");
const reviewValue = document.getElementById("reviewValue");
const riskFlags = document.getElementById("riskFlags");
const copyPayloadBtn = document.getElementById("copyPayloadBtn");
const installBtn = document.getElementById("installBtn");
const phaseFilter = document.getElementById("phaseFilter");

let deferredInstallPrompt = null;

function buildResult(state) {
  const serverTime = new Date().toISOString();
  const payload = {
    employeeId: 28,
    eventType: state.eventType,
    verificationStatus: state.passkeyStatus,
    occurredAtServer: serverTime,
    geofenceStatus: "unknown",
    requiresReview: false,
    primaryStatus: "pending",
    riskFlags: [],
    meta: {
      locationPermission: state.locationPermission,
      missionActive: state.missionActive,
      unknownDevice: state.unknownDevice,
      staleSession: state.staleSession
    }
  };

  if (state.passkeyStatus !== "verified") {
    payload.verificationStatus = "failed";
    payload.primaryStatus = "rejected";
    payload.requiresReview = true;
    payload.riskFlags.push("passkeymissing");
    payload.geofenceStatus = state.locationPermission === "denied" ? "permissiondenied" : state.geofenceState;
    return {
      badgeClass: "danger",
      badgeText: "مرفوضة",
      title: "لا يمكن اعتماد الحركة بدون Passkey ناجحة",
      description: "التحقق البيومتري المحلي فشل، لذلك لا تعتبر العملية حضورًا أو انصرافًا صالحًا حتى لو كان الموقع داخل النطاق.",
      payload
    };
  }

  if (state.locationPermission === "denied") {
    payload.geofenceStatus = "permissiondenied";
    payload.primaryStatus = state.eventType === "checkin" ? "present_review" : "checkout_review";
    payload.requiresReview = true;
    payload.riskFlags.push("locationdenied");
  } else if (state.locationPermission === "unknown") {
    payload.geofenceStatus = "unknown";
    payload.primaryStatus = state.eventType === "checkin" ? "present_review" : "checkout_review";
    payload.requiresReview = true;
  } else if (state.geofenceState === "insidebranch") {
    payload.geofenceStatus = "insidebranch";
    payload.primaryStatus = state.eventType === "checkin" ? "present" : "checkout";
  } else if (state.geofenceState === "insidemission") {
    payload.geofenceStatus = state.missionActive ? "insidemission" : "outsidebranch";
    payload.primaryStatus = state.missionActive ? "mission" : "present_review";
    payload.requiresReview = !state.missionActive;
    if (!state.missionActive) payload.riskFlags.push("geofencemiss");
  } else if (state.geofenceState === "outsidebranch") {
    payload.geofenceStatus = "outsidebranch";
    payload.primaryStatus = state.missionActive ? "mission" : "present_review";
    payload.requiresReview = !state.missionActive;
    if (!state.missionActive) payload.riskFlags.push("geofencemiss");
  } else {
    payload.geofenceStatus = "unknown";
    payload.primaryStatus = "present_review";
    payload.requiresReview = true;
  }

  if (state.unknownDevice) {
    payload.riskFlags.push("unknowndevice");
  }

  if (state.staleSession) {
    payload.riskFlags.push("stalesession");
  }

  const needsReview = payload.requiresReview;
  const safeMission = payload.primaryStatus === "mission";
  const acceptedAuto = !needsReview && payload.verificationStatus === "verified";

  return {
    badgeClass: acceptedAuto ? "" : needsReview ? "warning" : "danger",
    badgeText: acceptedAuto ? "مقبولة" : needsReview ? "تحتاج مراجعة" : "مرفوضة",
    title: acceptedAuto
      ? safeMission
        ? "تم قبول الحركة وربطها بالمأمورية"
        : "حركة موثقة ومقبولة تلقائيًا"
      : "الحركة محفوظة مع مراجعة مطلوبة",
    description: acceptedAuto
      ? safeMission
        ? "النظام قبل الحركة لأن الموظف داخل نطاق مأمورية معتمدة ونشطة."
        : "التحقق ناجح والموقع ضمن النطاق، لذلك تسجل الحركة مباشرة."
      : "تم حفظ الحركة مع Risk Flags وسيظهر اليوم في لوحة المراجعة لدى HR أو المدير المعتمد.",
    payload
  };
}

function renderRiskFlags(items) {
  riskFlags.innerHTML = "";

  if (!items.length) {
    const tag = document.createElement("span");
    tag.className = "safe";
    tag.textContent = "لا توجد مخاطر";
    riskFlags.appendChild(tag);
    return;
  }

  items.forEach((flag) => {
    const tag = document.createElement("span");
    tag.textContent = flag;
    riskFlags.appendChild(tag);
  });
}

function updateSimulator() {
  const state = {
    eventType: document.getElementById("eventType").value,
    passkeyStatus: document.getElementById("passkeyStatus").value,
    locationPermission: document.getElementById("locationPermission").value,
    geofenceState: document.getElementById("geofenceState").value,
    missionActive: document.getElementById("missionActive").checked,
    unknownDevice: document.getElementById("unknownDevice").checked,
    staleSession: document.getElementById("staleSession").checked
  };

  const result = buildResult(state);

  resultBadge.textContent = result.badgeText;
  resultBadge.className = `result-badge ${result.badgeClass}`.trim();
  resultTitle.textContent = result.title;
  resultDescription.textContent = result.description;

  verificationValue.textContent = result.payload.verificationStatus;
  geofenceValue.textContent = result.payload.geofenceStatus;
  reviewValue.textContent = result.payload.requiresReview ? "Yes" : "No";

  renderRiskFlags(result.payload.riskFlags);
  payloadPreview.textContent = JSON.stringify(result.payload, null, 2);
}

async function copyPayload() {
  try {
    await navigator.clipboard.writeText(payloadPreview.textContent);
    copyPayloadBtn.textContent = "تم النسخ";
    window.setTimeout(() => {
      copyPayloadBtn.textContent = "نسخ JSON";
    }, 1600);
  } catch {
    copyPayloadBtn.textContent = "تعذر النسخ";
    window.setTimeout(() => {
      copyPayloadBtn.textContent = "نسخ JSON";
    }, 1600);
  }
}

function setPhaseFilter(nextPhase) {
  document.querySelectorAll("#phaseFilter button").forEach((button) => {
    button.classList.toggle("active", button.dataset.phase === nextPhase);
  });

  document.querySelectorAll(".phase-card").forEach((card) => {
    const shouldShow = nextPhase === "all" || card.dataset.phase === nextPhase;
    card.style.display = shouldShow ? "" : "none";
  });
}

if (form) {
  form.addEventListener("input", updateSimulator);
  form.addEventListener("change", updateSimulator);
}

if (copyPayloadBtn) {
  copyPayloadBtn.addEventListener("click", copyPayload);
}

if (phaseFilter) {
  phaseFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-phase]");
    if (!button) return;
    setPhaseFilter(button.dataset.phase);
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.classList.remove("hidden");
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.classList.add("hidden");
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

updateSimulator();
setPhaseFilter("all");

