import { readAutoSendOverride, readAutopilotOverride } from "@/lib/webex/store";
import { resolveWebexSender } from "@/lib/webex/senderResolution";
import { readTokenRecord as readOutlookTokenRecord } from "@/lib/outlook/store";
import { getConfig } from "@/lib/config";

export type AutomationReadiness = {
  webexReady: boolean;
  outlookReady: boolean;
  autoSendEnabled: boolean;
  autoSendOverridden: boolean;
  autopilotEnabled: boolean;
};

async function isOutlookReady(): Promise<boolean> {
  const record = await readOutlookTokenRecord();
  if (!record) return false;
  const scopes = record.scope.split(/\s+/).map((s) => s.toLowerCase());
  return scopes.some((scope) => scope.includes("mail.send"));
}

/**
 * "Auto-send after analysis" is a separate automation setting from the
 * webhook-triggered "Webex transcript autopilot". It works for Demo,
 * Paste, Upload, and manually-selected Webex transcripts, and needs no
 * public URL. Its default (absent an explicit override) is enabled once
 * both Webex delivery and Outlook Mail.Send are ready.
 */
export async function getAutomationReadiness(): Promise<AutomationReadiness> {
  const [override, autopilotOverride, sender, outlookReady] = await Promise.all([
    readAutoSendOverride(),
    readAutopilotOverride(),
    resolveWebexSender(),
    isOutlookReady()
  ]);

  const webexReady = sender.mode !== "unavailable";
  const defaultEnabled = webexReady && outlookReady;

  return {
    webexReady,
    outlookReady,
    autoSendEnabled: override ?? defaultEnabled,
    autoSendOverridden: override !== null,
    autopilotEnabled: autopilotOverride ?? getConfig().WEBEX_AUTOPILOT_ENABLED
  };
}
