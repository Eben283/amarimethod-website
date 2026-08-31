// Read-only reconciliation for appointments whose canonical mutation history
// lives in Amari's append-only authority ledger. Provider-mirror observations
// are reconciled separately by appointment-projection-store.js.

const READ_LIMIT = 1000;
const ACTIVE_COMMAND_STATES = new Set(["accepted", "executing", "retryable", "manual_review"]);

function parseResult(command) {
  try {
    const result = command?.result_json ? JSON.parse(command.result_json) : null;
    return result && typeof result === "object" && !Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

function commandTime(command) {
  return command?.updated_at || command?.created_at || "";
}

function exactProviderLink(appointment, externalRecordsByAppointment) {
  if (!appointment.provider_appointment_id) return [];
  return (externalRecordsByAppointment.get(appointment.id) || []).filter((record) => (
    record.record_id === appointment.id
    && record.record_type === "appointment"
    && record.object_type === "appointment"
    && record.external_id === appointment.provider_appointment_id
  ));
}

function commandMutatesAppointment(command, result, appointment) {
  if (!result || result.action !== command.action || result.contactId !== appointment.contact_id) return false;
  if (command.action === "schedule") {
    return command.appointment_id === appointment.id
      && command.provider_record_id === appointment.provider_appointment_id
      && result.providerAppointmentId === appointment.provider_appointment_id;
  }
  if (command.action === "cancel") {
    return command.appointment_id === appointment.id
      && command.provider_record_id === appointment.provider_appointment_id
      && result.providerAppointmentId === appointment.provider_appointment_id
      && result.appointmentStatus === "cancelled";
  }
  if (command.action === "reschedule") {
    return (command.appointment_id === appointment.id
        && result.appointmentId === appointment.id
        && result.providerReplacementAppointmentId === command.provider_record_id)
      || (result.replacementAppointmentId === appointment.id
        && command.provider_record_id === appointment.provider_appointment_id
        && result.providerReplacementAppointmentId === appointment.provider_appointment_id);
  }
  return false;
}

export function reconcileOwnedAppointmentAuthority({
  appointments = [], commands = [], events = [], externalRecords = [], truncated = false,
} = {}) {
  const completedEvents = new Set(events
    .filter((event) => event.event_type === "completed")
    .map((event) => event.command_id));
  const rejectedEvents = new Set(events
    .filter((event) => event.event_type === "rejected")
    .map((event) => event.command_id));
  const issues = [];
  const records = [];
  const commandsByAppointment = new Map();
  const externalRecordsByAppointment = new Map();
  const addCommand = (appointmentId, entry) => {
    if (!appointmentId) return;
    if (!commandsByAppointment.has(appointmentId)) commandsByAppointment.set(appointmentId, []);
    const entries = commandsByAppointment.get(appointmentId);
    if (!entries.some((candidate) => candidate.command.id === entry.command.id)) entries.push(entry);
  };
  for (const command of commands) {
    const entry = { command, result: parseResult(command) };
    addCommand(command.appointment_id, entry);
    addCommand(command.source_appointment_id, entry);
    addCommand(entry.result?.replacementAppointmentId, entry);
  }
  for (const record of externalRecords) {
    if (!externalRecordsByAppointment.has(record.record_id)) externalRecordsByAppointment.set(record.record_id, []);
    externalRecordsByAppointment.get(record.record_id).push(record);
  }

  for (const appointment of appointments) {
    const appointmentCommands = commandsByAppointment.get(appointment.id) || [];
    const activeCommands = appointmentCommands.filter(({ command }) => ACTIVE_COMMAND_STATES.has(command.state));
    for (const { command } of activeCommands) {
      issues.push({
        code: "owned_command_incomplete",
        appointmentId: appointment.id,
        commandId: command.id,
        commandState: command.state,
        blocking: true,
      });
    }

    const completedCommands = appointmentCommands
      .filter(({ command }) => command.state === "completed")
      .filter(({ command, result }) => commandMutatesAppointment(command, result, appointment))
      .sort((left, right) => commandTime(left.command).localeCompare(commandTime(right.command)));

    for (const { command, result } of appointmentCommands.filter((item) => item.command.state === "completed")) {
      if (!result) {
        issues.push({ code: "owned_command_result_invalid", appointmentId: appointment.id, commandId: command.id, blocking: true });
      } else if (!completedEvents.has(command.id)) {
        issues.push({ code: "owned_completion_event_missing", appointmentId: appointment.id, commandId: command.id, blocking: true });
      }
    }

    const providerLinks = exactProviderLink(appointment, externalRecordsByAppointment);
    if (appointment.provider_sync_state === "synced") {
      if (!appointment.provider_appointment_id || providerLinks.length !== 1) {
        issues.push({ code: "owned_provider_link_invalid", appointmentId: appointment.id, providerAppointmentId: appointment.provider_appointment_id || null, blocking: true });
      }
      if (!completedCommands.length) {
        issues.push({ code: "owned_completion_proof_missing", appointmentId: appointment.id, providerAppointmentId: appointment.provider_appointment_id || null, blocking: true });
      }
      const latest = completedCommands.at(-1);
      if (latest && providerLinks.length === 1 && providerLinks[0].provider !== latest.command.provider) {
        issues.push({ code: "owned_provider_identity_mismatch", appointmentId: appointment.id, commandId: latest.command.id, blocking: true });
      }
      const latestExpectsCancelled = latest?.command.action === "cancel"
        || (latest?.command.action === "reschedule" && latest.command.appointment_id === appointment.id);
      if (appointment.status === "cancelled" && latest && !latestExpectsCancelled) {
        issues.push({ code: "owned_current_state_mismatch", appointmentId: appointment.id, expectedStatus: "cancelled", commandId: latest.command.id, blocking: true });
      }
      if (appointment.status !== "cancelled" && latestExpectsCancelled) {
        issues.push({ code: "owned_current_state_mismatch", appointmentId: appointment.id, expectedStatus: appointment.status, commandId: latest.command.id, blocking: true });
      }
    } else if (appointment.provider_sync_state === "not_required") {
      const terminalRejection = appointmentCommands.some(({ command }) => command.state === "rejected" && rejectedEvents.has(command.id));
      if (appointment.provider_appointment_id || appointment.status !== "cancelled" || !terminalRejection) {
        issues.push({ code: "owned_not_required_proof_invalid", appointmentId: appointment.id, blocking: true });
      }
    } else {
      issues.push({ code: "owned_provider_sync_incomplete", appointmentId: appointment.id, providerSyncState: appointment.provider_sync_state, blocking: true });
    }

    const recordIssues = issues.filter((issue) => issue.appointmentId === appointment.id);
    records.push({
      appointmentId: appointment.id,
      providerAppointmentId: appointment.provider_appointment_id || null,
      status: appointment.status,
      providerSyncState: appointment.provider_sync_state,
      evidenceSource: "appointment_authority_events",
      completedCommands: completedCommands.length,
      state: recordIssues.length ? "attention" : "verified",
      issueCodes: recordIssues.map((issue) => issue.code),
    });
  }

  if (truncated) issues.push({ code: "owned_authority_window_truncated", blocking: true });
  const blocking = issues.filter((issue) => issue.blocking !== false).length;
  return {
    state: blocking ? "attention" : "ready",
    summary: {
      appointments: appointments.length,
      verified: records.filter((record) => record.state === "verified").length,
      attention: records.filter((record) => record.state === "attention").length,
      blocking,
    },
    records,
    issues,
  };
}

export async function ownedAppointmentAuthorityReadiness(db, generatedAt) {
  try {
    const [countRow, appointmentsResult, commandsResult, eventsResult, externalResult] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE authority = 'owned'").bind().first(),
      db.prepare("SELECT id, contact_id, provider_appointment_id, status, provider_sync_state, created_at, updated_at FROM appointments WHERE authority = 'owned' ORDER BY updated_at DESC, id LIMIT ?").bind(READ_LIMIT).all(),
      db.prepare(`SELECT command.* FROM appointment_authority_commands command
        WHERE EXISTS (SELECT 1 FROM appointments appointment WHERE appointment.id = command.appointment_id AND appointment.authority = 'owned')
        ORDER BY command.updated_at DESC, command.id LIMIT ?`).bind(READ_LIMIT * 3).all(),
      db.prepare(`SELECT event.* FROM appointment_authority_events event
        WHERE EXISTS (SELECT 1 FROM appointments appointment WHERE appointment.id = event.appointment_id AND appointment.authority = 'owned')
        ORDER BY event.occurred_at DESC, event.id LIMIT ?`).bind(READ_LIMIT * 10).all(),
      db.prepare(`SELECT external.provider, external.object_type, external.external_id,
          external.record_type, external.record_id
        FROM external_records external
        WHERE external.object_type = 'appointment'
          AND EXISTS (SELECT 1 FROM appointments appointment WHERE appointment.id = external.record_id AND appointment.authority = 'owned')
        ORDER BY external.last_seen_at DESC, external.id LIMIT ?`).bind(READ_LIMIT * 3).all(),
    ]);
    const appointments = appointmentsResult.results || [];
    const totalAppointments = Number(countRow?.count || 0);
    const reconciliation = reconcileOwnedAppointmentAuthority({
      appointments,
      commands: commandsResult.results || [],
      events: eventsResult.results || [],
      externalRecords: externalResult.results || [],
      truncated: totalAppointments > appointments.length,
    });
    return {
      configured: true,
      state: reconciliation.state,
      generatedAt,
      appendOnlyEvidence: true,
      coverage: { appointmentsRead: appointments.length, totalAppointments, truncated: totalAppointments > appointments.length },
      reconciliation,
    };
  } catch (error) {
    return {
      configured: false,
      state: "unavailable",
      generatedAt,
      appendOnlyEvidence: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
