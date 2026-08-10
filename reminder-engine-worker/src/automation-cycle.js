import { runSweep } from "./engine.js";
import { reconcileDeliveryReceipts } from "./delivery-receipts.js";

export async function runAutomationCycle(env, nowMs, dependencies = {}) {
  const sendSweep = dependencies.runSweep || runSweep;
  const receiptSweep = dependencies.reconcileDeliveryReceipts || reconcileDeliveryReceipts;
  let sends;
  try {
    sends = await sendSweep(env, nowMs);
  } catch (error) {
    sends = { errors: 1, fatal: String(error?.message || error) };
    console.error(JSON.stringify({ message: "reminder send sweep failed", error: sends.fatal }));
  }
  let receipts;
  try {
    receipts = await receiptSweep(env, nowMs);
  } catch (error) {
    receipts = { checked: 0, recorded: 0, pending: 0, errors: 1, fatal: String(error?.message || error) };
    console.error(JSON.stringify({ message: "delivery receipt sweep failed", error: receipts.fatal }));
  }
  return { sends, receipts };
}
