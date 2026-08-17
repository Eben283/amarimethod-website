// Automation-exit recovery contract for the three existing reminder families.
//
// This is deliberately declarative and shadow-safe. It records the inputs,
// temporary GHL dependencies, evidence, and rollback boundary that a lifecycle
// must satisfy before its sender can be activated. It is not a new automation
// engine and it does not enable delivery.
const COMMON_INGRESS = Object.freeze([
  "contactId", "appointmentId", "calendarId", "startAt", "status",
]);

const REQUIRED_NODE_FIELDS = Object.freeze([
  "owner", "transport", "successEvidence", "idempotencyKey", "failureOwner",
  "cancellation", "reschedule", "missingData", "timeout", "downstreamGuarantee",
]);

function nodeContract(owner, transport, successEvidence, downstreamGuarantee) {
  return Object.freeze({
    owner,
    transport,
    successEvidence,
    idempotencyKey: "workflowId:appointmentId:nodeId:definitionVersion",
    failureOwner: "Amari Operations",
    cancellation: "cancel pending node by workflowId + appointmentId",
    reschedule: "retime pending node or preserve immutable completed evidence",
    missingData: "record durable failure; do not send",
    timeout: "surface an actionable operations exception",
    downstreamGuarantee,
  });
}

export const REMINDER_FAMILY_CONTRACTS = Object.freeze({
  "initial-in-person": Object.freeze({
    workflowId: "initial-in-person",
    temporaryGhlDependencies: Object.freeze([
      "GHL contact and calendar compatibility edge",
      "Appointment Events Webhook ingress",
      "Existing GHL sender is the rollback path until owned delivery is proven",
    ]),
    requiredIngress: COMMON_INGRESS,
    nodes: Object.freeze({
      "booked-internal": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "staff notification is inspectable"),
      confirmation: nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "client has a recorded confirmation attempt"),
      "day-before": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "future one-hour nodes remain retimable"),
      "one-hour-sms": nodeContract("Amari reminder engine", "sms", "terminal transport status", "no duplicate SMS for the same node"),
      "starting-soon": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "completion is immutable evidence"),
      "one-hour-internal": nodeContract("Amari reminder engine", "sms", "terminal transport status", "staff notice is inspectable"),
    }),
  }),
  "initial-virtual": Object.freeze({
    workflowId: "initial-virtual",
    temporaryGhlDependencies: Object.freeze([
      "GHL contact and calendar compatibility edge",
      "Appointment Events Webhook ingress",
      "Existing GHL sender is the rollback path until owned delivery is proven",
    ]),
    requiredIngress: COMMON_INGRESS,
    nodes: Object.freeze({
      "booked-internal": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "staff notification is inspectable"),
      welcome: nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "client has a recorded welcome attempt"),
      "day-before": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "future one-hour nodes remain retimable"),
      "one-hour-email": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "completion is immutable evidence"),
      "one-hour-sms": nodeContract("Amari reminder engine", "sms", "terminal transport status", "no duplicate SMS for the same node"),
      "one-hour-internal": nodeContract("Amari reminder engine", "sms", "terminal transport status", "staff notice is inspectable"),
    }),
  }),
  "follow-up-session-reminders": Object.freeze({
    workflowId: "follow-up-session-reminders",
    temporaryGhlDependencies: Object.freeze([
      "GHL contact and calendar compatibility edge",
      "Appointment Events Webhook ingress with canonical normal-event verification",
      "Follow up session Confirmation email / reminder flow remains sender and rollback path until owned delivery is proven",
      "GHL No Show Email SMS series remains an explicit external exit dependency",
    ]),
    requiredIngress: Object.freeze([...COMMON_INGRESS, "appointmentEventType"]),
    nodes: Object.freeze({
      "remove-no-show-series": nodeContract("Amari reminder engine", "control", "durable exit receipt", "no-show ownership is explicit rather than implicit"),
      "booked-internal": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "staff notification is inspectable"),
      confirmation: nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "client has a recorded confirmation attempt"),
      "day-before": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "future one-hour nodes remain retimable"),
      "one-hour-email": nodeContract("Amari reminder engine", "email", "provider acceptance plus durable message reference", "completion is immutable evidence"),
      "one-hour-sms": nodeContract("Amari reminder engine", "sms", "terminal transport status", "no duplicate SMS for the same node"),
      "one-hour-internal": nodeContract("Amari reminder engine", "sms", "terminal transport status", "staff notice is inspectable"),
    }),
  }),
});

export function validateReminderFamilyContract(workflow, contract) {
  const errors = [];
  if (!workflow || !contract || workflow.id !== contract.workflowId) errors.push("workflow id does not match contract");
  if (workflow?.executionMode !== "shadow") errors.push("recovery contract may only cover shadow workflows");
  if (!Array.isArray(contract?.requiredIngress) || !contract.requiredIngress.length) errors.push("required ingress is missing");
  if (!Array.isArray(contract?.temporaryGhlDependencies) || !contract.temporaryGhlDependencies.length) errors.push("temporary GHL dependencies are missing");
  const workflowNodes = new Map((workflow?.nodes || []).map((node) => [node.id, node]));
  for (const [nodeId, node] of Object.entries(contract?.nodes || {})) {
    if (!workflowNodes.has(nodeId)) errors.push(`contract node ${nodeId} is not in the workflow`);
    for (const field of REQUIRED_NODE_FIELDS) if (!String(node?.[field] || "").trim()) errors.push(`contract node ${nodeId} is missing ${field}`);
  }
  for (const nodeId of workflowNodes.keys()) if (!contract?.nodes?.[nodeId]) errors.push(`workflow node ${nodeId} has no contract`);
  return errors;
}
