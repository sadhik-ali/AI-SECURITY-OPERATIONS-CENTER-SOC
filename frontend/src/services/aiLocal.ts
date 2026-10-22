import type { AiAnalysis, AiChatResponse, Alert, ChatMessage, Incident, SecurityEvent } from '../types/api';

/**
 * Phase 1 deterministic responder.
 * It reads the real sample-data records for an incident and composes an answer —
 * it does not call any model. Phase 6 deletes this module and calls POST /api/ai/chat instead.
 */
export const LOCAL_MODEL_LABEL = 'local-deterministic-responder/v0.1';

export class AiUnavailableError extends Error {
  constructor(message = 'Analysis backend unavailable') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

interface Pattern {
  id: string;
  match: RegExp;
  headline: string;
  hypotheses: string[];
  steps: string[];
  actions: string[];
}

const PATTERNS: Pattern[] = [
  {
    id: 'brute_force',
    match: /brute|5760|failed password|authentication failure/i,
    headline: 'credential brute forcing against a publicly reachable authentication service',
    hypotheses: [
      'Internet background noise from a scanner/botnet harvesting weak SSH credentials.',
      'Targeted credential-stuffing run using a leaked username list.',
      'Compromised proxy rebinding to the same source ASN between attempts.',
    ],
    steps: [
      'Count failed attempts per username to separate password guessing from username spraying.',
      'Check whether any attempt from the same source eventually authenticated.',
      'Confirm the source IP is not a vetted partner, VPN exit or vulnerability-scanner range.',
      'Review the agent-side auth logs for the same window to rule out log truncation.',
    ],
    actions: [
      'Block the source at the perimeter and add it to the 30-day deny list.',
      'Disable password authentication for SSH; require keys plus MFA.',
      'Enable progressive lockout / rate limiting on the affected service.',
      'Rotate credentials for every account named in the attempt set.',
    ],
  },
  {
    id: 'login_after_failure',
    match: /successful login after|after multiple failed|valid account|5715/i,
    headline: 'a successful authentication immediately following failed attempts from the same source',
    hypotheses: [
      'Credential guessing succeeded and the attacker is now operating with valid credentials.',
      'A user mistyped a password from a new location and then authenticated correctly.',
      'Automation retried a stale credential that was rotated late.',
    ],
    steps: [
      'Correlate the successful session with commands executed afterwards in the same window.',
      'Compare the source IP geolocation and ASN with the user history for that account.',
      'Look for lateral movement from the host within 30 minutes of the successful login.',
      'Verify whether MFA was challenged and satisfied for the successful attempt.',
    ],
    actions: [
      'Terminate the session and invalidate refresh tokens for the account.',
      'Isolate the host if privileged commands or data reads followed the login.',
      'Force a credential reset and re-enrol MFA.',
      'Preserve the host disk and full auth logs for forensic review.',
    ],
  },
  {
    id: 'password_spray',
    match: /spray|4625|4776|multiple accounts/i,
    headline: 'low-and-slow password spraying across many accounts from one source',
    hypotheses: [
      'External attacker cycling one common password across a harvested user list.',
      'An internal misconfigured application retrying authentication against the DC.',
      'Pretext for a subsequent account-takeover attempt during a busy period.',
    ],
    steps: [
      'Group failures by source IP and password-string length to confirm single-password spray.',
      'Identify any account that produced a success event (4624) in the same window.',
      'Check the failure ratio per account to find lockout-threshold bypass pacing.',
      'Confirm whether affected users are enabled, remote-capable and MFA-enrolled.',
    ],
    actions: [
      'Enforce a domain lockout policy that survives low-and-slow attempts.',
      'Require MFA for all VPN, RDP and Outlook Web Access authentication paths.',
      'Block the source and notify owners of the targeted accounts.',
      'Reset passwords for accounts that overlap with the spray set.',
    ],
  },
  {
    id: 'privilege_escalation',
    match: /privileg|domain admin|group membership|4728|4732|seprivatelaudit/i,
    headline: 'authorisation change that grants an account a privileged group membership',
    hypotheses: [
      'Attacker with stolen admin credentials establishing persistence through group membership.',
      'Service account abused to self-add to a privileged group.',
      'Legitimate change executed outside the change-management process.',
    ],
    steps: [
      'Identify the account that performed the addition and its own privilege lineage.',
      'Check for the parent authentication event and the logon workstation used.',
      'Review all group changes on the DC for the preceding 24 hours.',
      'Search for Kerberos service-ticket requests by the newly privileged account.',
    ],
    actions: [
      'Remove the group membership and disable the offending account.',
      'Revoke all sessions and refresh tickets for the affected accounts.',
      'If a domain group was abused, schedule a double KRBTGT reset.',
      'Escalate to identity owners and record the change-ticket reference.',
    ],
  },
  {
    id: 'lsass_mimikatz',
    match: /lsass|mimikatz|credential dumping|10\b.*process accessed|grantedaccess/i,
    headline: 'direct memory access to LSASS consistent with credential dumping',
    hypotheses: [
      'Off-the-shelf credential-theft tooling executed from a user-writable path.',
      'Fileless variant reflecting lsass.exe into another process.',
      'Red-team or pen-test activity that was not deconflicted.',
    ],
    steps: [
      'Retrieve the process image path, hash and command line for the accessing process.',
      'Check whether the same hash appears on other hosts via Sysmon event ID 1/7/11.',
      'Look for subsequent logons with newly materialised credentials on the DC.',
      'Confirm AV/EDR quarantine state and whether real-time protection was disabled.',
    ],
    actions: [
      'Isolate the host from the network and keep it powered for memory capture.',
      'Reset the cached credentials of every account that logged on to the host.',
      'Add the binary hash to the deny list and push an EDR custom detection.',
      'Assume domain compromise if a privileged account was present; begin escalation.',
    ],
  },
  {
    id: 'port_scan',
    match: /port scan|scan|ufw block|rejected|connection attempt|syn/i,
    headline: 'volumetric connection attempts across many destinations ports',
    hypotheses: [
      'Automated internet-wide reconnaissance from a scanning network.',
      'Pre-exploitation enumeration by an actor with a foothold in the range.',
      'Authorised vulnerability scan that was not registered with the SOC.',
    ],
    steps: [
      'Enumerate distinct destination ports and target hosts per source IP.',
      'Determine whether any connection was accepted rather than blocked.',
      'Check asset inventory for services exposed on the scanned ports.',
      'Verify the source against the approved scanner allow-list.',
    ],
    actions: [
      'Sinkhole or null-route the source and close unneeded public listeners.',
      'Patch or firewall any service discovered on an accepted port.',
      'Reduce banner disclosure on the exposed listeners.',
      'Document the scan in the threat-intel tracker for ASN-level trending.',
    ],
  },
  {
    id: 'exfiltration',
    match: /exfil|outbound|bytes_out|copy to|large transfer|transfer/i,
    headline: 'outbound data volume well above the baseline for the host and service',
    hypotheses: [
      'Staged data being pushed to attacker-controlled infrastructure.',
      'Backup or replication job misconfigured to an unexpected endpoint.',
      'Legitimate analytics extract that bypassed the approved pipeline.',
    ],
    steps: [
      'Break the transfer down by destination, port and time buckets.',
      'Identify the process and account owning the connection.',
      'Compare the transferred volume with the 30-day baseline for that endpoint.',
      'Check DNS resolution history for the destination hostname.',
    ],
    actions: [
      'Restrict egress from the database subnet to an allow-list only.',
      'Suspend the responsible account or job until the purpose is verified.',
      'Preserve netflow plus query logs as evidence of the transfer.',
      'Assess regulatory scope if personal data left the environment.',
    ],
  },
  {
    id: 'suspicious_process',
    match: /process|image load|file write|suspicious|named pipe|powershell/i,
    headline: 'process execution that deviates from the host baseline',
    hypotheses: [
      'Administrator tooling run from an unusual path.',
      'Dropped second-stage payload after a phishing click.',
      'Living-off-the-land binary invoked with attacker-supplied arguments.',
    ],
    steps: [
      'Pull the parent process chain and signing state.',
      'Detonate the binary hash against internal sandbox history.',
      'Enumerate persistence: scheduled tasks, services, run keys.',
      'Check for the same telemetry on peer hosts in the OU.',
    ],
    actions: [
      'Quarantine the file and block the hash fleet-wide.',
      'Isolate the endpoint pending scan results.',
      'Force credential refresh on the endpoint if interactive logons occurred.',
      'Update the application allow-list policy gap that permitted execution.',
    ],
  },
];

const GENERIC: Pattern = {
  id: 'generic',
  match: /.*/,
  headline: 'activity that deviates from the established baseline for the affected assets',
  hypotheses: ['Unreviewed administrative change.', 'Automated job emitting anomalous telemetry.', 'Early-stage intrusion with limited signal.'],
  steps: ['Widen the search to the same user, host and source over the previous 7 days.', 'Validate the detection rule against raw logs for false-positive indicators.', 'Attach the underlying events to the incident before escalating.'],
  actions: ['Reduce exposure of the affected asset while the review is open.', 'Record the triage decision on the incident so the rule can be tuned.'],
};

const evidenceFromEvents = (events: SecurityEvent[], limit = 6): string[] => {
  if (!events.length) return [];
  return events.slice(0, limit).map((e) => {
    const who = e.username ? ` user=${e.username}` : '';
    const src = e.src_ip ? ` src=${e.src_ip}` : '';
    return `${e.timestamp.slice(11, 19)}Z ${e.hostname ?? 'unknown-host'} ${e.event_type}${src}${who} severity=${e.severity}`;
  });
};

const alertEvidence = (alerts: Alert[]): string[] =>
  alerts.map(
    (a) =>
      `Alert #${a.id} [${a.severity}] ${a.rule_name} — ${a.detection_reason}${a.src_ip ? ` (source ${a.src_ip})` : ''}${
        a.hostname ? ` on ${a.hostname}` : ''
      }`,
  );

export function analyzeIncident(incident: Incident, alerts: Alert[], events: SecurityEvent[]): AiAnalysis {
  const corpus = `${incident.title} ${incident.description} ${incident.rules_triggered.join(' ')}`;
  const pattern = PATTERNS.find((p) => p.match.test(corpus)) ?? GENERIC;
  const severityCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.severity] = (acc[e.severity] ?? 0) + 1;
    return acc;
  }, {});
  const sources = Array.from(new Set(alerts.map((a) => a.src_ip).filter((x): x is string => Boolean(x))));
  const hosts = Array.from(new Set(events.map((e) => e.hostname).filter((x): x is string => Boolean(x))));
  const users = Array.from(new Set(events.map((e) => e.username).filter((x): x is string => Boolean(x))));
  const critical = incident.severity === 'critical' || incident.severity === 'high';
  const confidence = Math.min(0.94, Math.max(0.32, 0.34 + alerts.length * 0.09 + Math.min(events.length, 40) * 0.008));

  return {
    summary:
      `${incident.reference} covers ${pattern.headline}. ${alerts.length} alert(s) and ${events.length} correlated event(s) ` +
      `were observed across ${hosts.length || 'no'} host(s)${hosts.length ? ` (${hosts.slice(0, 3).join(', ')})` : ''}, ` +
      `involving ${users.length || 'no'} account(s)${users.length ? ` (${users.slice(0, 3).join(', ')})` : ''}` +
      `${sources.length ? `, with ${sources.length} external source(s) ${sources.slice(0, 3).join(', ')}` : ''}. ` +
      `Current assessment is ${incident.severity.toUpperCase()} at risk score ${incident.risk_score}/100, status ${incident.status}.`,
    severity_assessment:
      `${incident.severity.toUpperCase()} — driven by ${
        critical ? 'authentication abuse against systems that reach privileged paths' : 'volume-based anomalies without confirmed impact'
      }. ` +
      `Event mix: ${Object.entries(severityCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || 'no events attached'}.`,
    evidence: [...alertEvidence(alerts), ...evidenceFromEvents(events)],
    possible_explanations: pattern.hypotheses,
    investigation_steps: pattern.steps,
    recommended_actions: pattern.actions,
    confidence: Number(confidence.toFixed(2)),
    limitations: [
      'Derived from correlated alerts and events only; no full-disk, memory or netflow capture is attached.',
      'Phase 1 answers come from a local deterministic responder, not a hosted model — no external threat-intelligence enrichment.',
      'Impact assessment assumes the sample data set is complete for the incident window.',
    ],
  };
}

export function analyzeAlert(alert: Alert, events: SecurityEvent[]): AiAnalysis {
  const corpus = `${alert.rule_name} ${alert.detection_reason} ${alert.event_category}`;
  const pattern = PATTERNS.find((p) => p.match.test(corpus)) ?? GENERIC;
  return {
    summary:
      `Alert #${alert.id} "${alert.rule_name}" (${alert.severity}) on ${alert.hostname ?? 'unknown host'} at ` +
      `${alert.timestamp.slice(11, 19)}Z: ${alert.detection_reason}. ${events.length} raw event(s) back the finding. ` +
      `Reads as ${pattern.headline}.`,
    severity_assessment: `${alert.severity.toUpperCase()} — category ${alert.event_category}, status ${alert.investigation_status}.`,
    evidence: [
      `rule=${alert.rule_name}`,
      `category=${alert.event_category}`,
      `reason=${alert.detection_reason}`,
      `source=${alert.src_ip ?? 'n/a'} destination=${alert.dst_ip ?? 'n/a'}`,
      `agent=${alert.hostname ?? 'n/a'} user=${alert.username ?? 'n/a'} feed=${alert.source}`,
      ...evidenceFromEvents(events, 4),
    ],
    possible_explanations: pattern.hypotheses,
    investigation_steps: pattern.steps,
    recommended_actions: pattern.actions,
    confidence: Number(Math.min(0.9, 0.3 + events.length * 0.05 + (alert.severity === 'critical' ? 0.2 : 0.1)).toFixed(2)),
    limitations: ['Single-alert scope; no correlated incident context requested.', 'Local deterministic responder — no live model inference.'],
  };
}

type SectionKey = 'summary' | 'evidence' | 'hypotheses' | 'steps' | 'actions' | 'severity' | 'limitations' | 'context';

const SECTION_HEADERS: Record<SectionKey, string> = {
  summary: 'EVIDENCE-BASED SUMMARY',
  evidence: 'EVIDENCE (observed in the data)',
  hypotheses: 'HYPOTHESIS (not yet confirmed)',
  steps: 'RECOMMENDATION — INVESTIGATION STEPS',
  actions: 'RECOMMENDATION — DEFENSIVE ACTIONS',
  severity: 'SEVERITY & RISK',
  limitations: 'LIMITATIONS',
  context: 'INCIDENT CONTEXT',
};

function section(key: SectionKey, lines: string[]): string {
  return `**${SECTION_HEADERS[key]}**\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function entityContext(alerts: Alert[], events: SecurityEvent[]): string[] {
  const ips = new Map<string, number>();
  const hosts = new Map<string, number>();
  const users = new Map<string, number>();
  for (const e of events) {
    if (e.src_ip) ips.set(e.src_ip, (ips.get(e.src_ip) ?? 0) + 1);
    if (e.hostname) hosts.set(e.hostname, (hosts.get(e.hostname) ?? 0) + 1);
    if (e.username) users.set(e.username, (users.get(e.username) ?? 0) + 1);
  }
  const fmt = (label: string, m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k} (${v})`)
      .join(', ')
      .replace(/^/, `${label}: `);
  const out: string[] = [];
  if (ips.size) out.push(fmt('Source IPs', ips));
  if (hosts.size) out.push(fmt('Hosts', hosts));
  if (users.size) out.push(fmt('Accounts', users));
  out.push(`Alerts attached: ${alerts.map((a) => `#${a.id} ${a.rule_name}`).join('; ') || 'none'}`);
  out.push(`Window: ${events.length ? `${events[events.length - 1]?.timestamp} → ${events[0]?.timestamp}` : 'no events'}`);
  return out;
}

const INTENTS: { key: SectionKey; test: RegExp }[] = [
  { key: 'summary', test: /summ|what happened|overview|tl;?dr|brief|explain/i },
  { key: 'evidence', test: /evidence|proof|log|indicator|artefact|artifact|seen|observ/i },
  { key: 'hypotheses', test: /why|hypothes|cause|explain the|possibl|could it be|intent|attacker/i },
  { key: 'steps', test: /next step|investigat|how should|triage|what do i do|approach/i },
  { key: 'actions', test: /block|remediat|contain|fix|action|recommend|hardening|response/i },
  { key: 'severity', test: /severity|risk|score|critical|priority|cvss|impact/i },
  { key: 'limitations', test: /confiden|limitation|sure|accuracy|false positive|wrong|trust/i },
  { key: 'context', test: /who|which (ip|host|user|account)|source|target|asset|entit|scope|timeline|when/i },
];

export interface ChatContext {
  incident: Incident | null;
  alerts: Alert[];
  events: SecurityEvent[];
}

export function chatReply(message: string, ctx: ChatContext, history: ChatMessage[]): AiChatResponse {
  const text = message.trim();
  if (!text) {
    return {
      reply: 'Ask something specific about the selected incident — for example "summarise the evidence" or "what should I block?".',
      analysis: null,
      model: LOCAL_MODEL_LABEL,
      degraded: false,
    };
  }

  const analysis = ctx.incident ? analyzeIncident(ctx.incident, ctx.alerts, ctx.events) : null;

  if (!ctx.incident) {
    return {
      reply:
        'No incident is selected. The assistant answers only from a real incident record so every statement can be traced back to data. ' +
        'Pick an incident in the selector and ask again.',
      analysis: null,
      model: LOCAL_MODEL_LABEL,
      degraded: false,
    };
  }

  if (/^(hello|hi|hey)\b/i.test(text)) {
    return {
      reply: `Connected to ${analysis!.summary.split('.')[0]}. Ask for evidence, hypotheses, next steps or blocking actions.`,
      analysis,
      model: LOCAL_MODEL_LABEL,
      degraded: false,
    };
  }

  const intent = INTENTS.find((i) => i.test.test(text));
  if (!intent) {
    return {
      reply:
        `I answered from ${ctx.incident.reference} only. I can cover: summary, evidence, hypotheses, investigation steps, ` +
        `defensive actions, severity/risk, confidence and affected entities.\n\n${section('summary', [analysis!.summary])}`,
      analysis,
      model: LOCAL_MODEL_LABEL,
      degraded: false,
    };
  }

  const lines = (() => {
    switch (intent.key) {
      case 'evidence':
        return analysis!.evidence;
      case 'hypotheses':
        return analysis!.possible_explanations;
      case 'steps':
        return analysis!.investigation_steps;
      case 'actions':
        return analysis!.recommended_actions;
      case 'severity':
        return [analysis!.severity_assessment, `Risk score ${ctx.incident.risk_score}/100`, `Confidence ${Math.round(analysis!.confidence * 100)}%`];
      case 'limitations':
        return [...analysis!.limitations, `Responder confidence ${Math.round(analysis!.confidence * 100)}%`];
      case 'context':
        return entityContext(ctx.alerts, ctx.events);
      default:
        return [analysis!.summary];
    }
  })();

  const lead =
    intent.key === 'evidence'
      ? `Observed in the attached records for ${ctx.incident.reference}:`
      : intent.key === 'hypotheses'
        ? `These are interpretations, not confirmed facts:`
        : intent.key === 'context'
          ? `From the ${ctx.events.length} correlated event(s):`
          : `Based on ${ctx.alerts.length} alert(s) and ${ctx.events.length} event(s):`;

  const followUp = history.length > 2 ? '\n\n_Synthesising the last ' + history.length + ' turns of this thread._' : '';

  return { reply: `${lead}\n\n${section(intent.key, lines)}${followUp}`, analysis, model: LOCAL_MODEL_LABEL, degraded: false };
}
