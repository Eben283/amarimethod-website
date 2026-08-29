// Cloudflare Pages Function: POST /api/staff-send-toolkit
// Sends the partner toolkit SMS, adds affiliate-partner tag, and updates pipeline to Partner/Won

import { ghlFetch, applyTagDelta } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { requireProviderContactIdentity, resolveOwnedContactIdentity } from "../lib/staff-owned-contact-identity.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const TOOLKIT_MESSAGE = `Hey! Here's your Amari Method partner toolkit — everything you need to refer clients and track your earnings:\n\nhttps://www.amarimethod.com/partner-app\n\nLog in with your email and you're all set. Reach out anytime if you have questions!`;


export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    // Parse request
    const { body, error: parseError } = await parseJsonBody(context.request, headers);

    if (parseError) return parseError;
    const { contactId: contactReference } = body;

    if (!contactReference) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }
    const contactId = requireProviderContactIdentity(
      await resolveOwnedContactIdentity(context, contactReference),
    );

    // Verify contact exists and has affiliate-partner tag
    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;
    const tags = contact.tags || [];

    if (!tags.includes("partner-session-booked") && !tags.includes("affiliate-partner")) {
      return new Response(JSON.stringify({ error: "Contact is not a partner" }), { status: 400, headers });
    }

    if (!contact.phone) {
      return new Response(JSON.stringify({ error: "Contact has no phone number" }), { status: 400, headers });
    }

    // Add affiliate-partner tag if not already present. Use the dedicated tag
    // endpoint (additive) rather than a full-array PUT so concurrent contact
    // writes don't clobber each other's tags. Best-effort: applyTagDelta throws
    // on a non-ok GHL response (unlike the old bare ghlFetch PUT), so guard it —
    // a transient tag failure must not block the toolkit SMS that follows.
    if (!tags.includes("affiliate-partner")) {
      try {
        await applyTagDelta(context, contactId, { add: ["affiliate-partner"] });
      } catch (tagErr) {
        console.error(`[staff-send-toolkit] affiliate-partner tag add failed: ${tagErr.message}`);
      }
    }

    // Update Partnership Pipeline opportunity to Partner/Won
    try {
      const pipelinesRes = await ghlFetch(context, `${GHL_API_BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`);
      if (pipelinesRes.ok) {
        const pipelinesData = await pipelinesRes.json();
        const partnership = (pipelinesData.pipelines || []).find(
          (p) => p.name.toLowerCase().includes("partnership")
        );
        if (partnership) {
          const partnerStage = (partnership.stages || []).find(
            (s) => s.name === "Partner"
          );
          if (partnerStage) {
            const oppsRes = await ghlFetch(
              context,
              `${GHL_API_BASE}/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${partnership.id}&contact_id=${contactId}`
            );
            if (oppsRes.ok) {
              const oppsData = await oppsRes.json();
              const opp = (oppsData.opportunities || []).find(
                (o) => o.pipelineId === partnership.id
              );
              if (opp) {
                await ghlFetch(context, `${GHL_API_BASE}/opportunities/${opp.id}`, {
                  method: "PUT",
                  body: JSON.stringify({
                    pipelineStageId: partnerStage.id,
                    status: "won",
                  }),
                });
              }
            }
          }
        }
      }
    } catch (err) {
      // Pipeline update is best-effort — don't block toolkit send
      console.error(`[staff-send-toolkit] Pipeline update failed: ${err.message}`);
    }

    // Send SMS via GHL conversations API
    const smsRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message: TOOLKIT_MESSAGE,
      }),
    });

    if (!smsRes.ok) {
      const errText = await smsRes.text();
      console.error(`[staff-send-toolkit] SMS send failed: ${smsRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to send SMS" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-send-toolkit] Error:", err.message);
    if (String(err?.code || "").startsWith("owned_") || String(err?.code || "").startsWith("provider_")) {
      const status = [400, 404, 409, 503].includes(Number(err?.status)) ? Number(err.status) : 503;
      return new Response(JSON.stringify({ error: err.message, code: err.code }), { status, headers });
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
