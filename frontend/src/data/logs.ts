import type { EventSource, Severity } from '../types/api';
import type { HostFixture } from './fixtures';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function syslogTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function isoTime(ts: number): string {
  return new Date(ts).toISOString();
}

export function winTime(ts: number): string {
  return `${isoTime(ts).slice(0, 19)}.${String(ts % 1000).padStart(3, '0')}Z`;
}

const pad = (n: number, w = 5) => String(n).padStart(w, '0');

export function sshdFailed(
  ts: number,
  host: HostFixture,
  username: string,
  srcIp: string,
  port: number,
  invalid = true,
): string {
  return (
    `${syslogTime(ts)} ${host.hostname} sshd[${pad(host.agent_id.charCodeAt(1) * 91 + port % 997)}]: ` +
    `Failed password for ${invalid ? 'invalid user ' : ''}${username} from ${srcIp} port ${port} ssh2`
  );
}

export function sshdAccepted(ts: number, host: HostFixture, username: string, srcIp: string, port: number): string {
  return (
    `${syslogTime(ts)} ${host.hostname} sshd[${pad(20000 + (port % 900))}]: ` +
    `Accepted password for ${username} from ${srcIp} port ${port} ssh2`
  );
}

export function sshdPam(ts: number, host: HostFixture, username: string, srcIp: string): string {
  return (
    `${syslogTime(ts)} ${host.hostname} sshd[${pad(21418)}]: pam_unix(sshd:auth): ` +
    `authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=${srcIp} user=${username}`
  );
}

export function sudoLine(
  ts: number,
  host: HostFixture,
  username: string,
  tty: string,
  command: string,
  failed = false,
): string {
  return (
    `${syslogTime(ts)} ${host.hostname} sudo${pad(10991, 4)}: ${failed ? '3 incorrect password attempts ; ' : ''}` +
    `${username} : TTY=${tty} ; PWD=/home/${username} ; USER=root ; COMMAND=${command}`
  );
}

export function connTrack(ts: number, host: HostFixture, srcIp: string, srcPort: number, dstIp: string, dstPort: number): string {
  return (
    `${syslogTime(ts)} ${host.hostname} kernel: [UFW BLOCK] IN=eth0 OUT= ` +
    `SRC=${srcIp} DST=${dstIp} PROTO=TCP SPT=${srcPort} DPT=${dstPort} WINDOW=1024 SYN URGP=0`
  );
}

export function cronLine(ts: number, host: HostFixture, username: string, cmd: string): string {
  return `${syslogTime(ts)} ${host.hostname} CRON[${pad(28417)}]: (${username}) CMD (${cmd})`;
}

export function sshdSessionOpen(ts: number, host: HostFixture, username: string): string {
  return (
    `${syslogTime(ts)} ${host.hostname} sshd[${pad(24102)}]: pam_unix(sshd:session): ` +
    `session opened for user ${username} by (uid=0)`
  );
}

/** Wazuh manager alert envelope, rendered the way the indexer stores it. */
export function wazuhAlert(opts: {
  ts: number;
  host: HostFixture;
  ruleId: string;
  level: number;
  description: string;
  groups: string[];
  mitre?: string[];
  srcIp?: string;
  dstIp?: string;
  srcPort?: number;
  user?: string;
  fullEvent: string;
}): string {
  return JSON.stringify(
    {
      timestamp: isoTime(opts.ts),
      rule: {
        level: opts.level,
        description: opts.description,
        id: opts.ruleId,
        mailed: false,
        groups: opts.groups,
        mitre: opts.mitre ? { technique: opts.mitre, id: opts.mitre } : undefined,
        firedtimes: 1,
        pci_dss: opts.groups.includes('authentication_failed') ? ['10.2.4'] : ['11.4'],
      },
      agent: { id: opts.host.agent_id, name: opts.host.hostname, ip: opts.host.ip },
      manager: { name: 'monitor-01' },
      id: `17${String(opts.ts).slice(-8)}0${(opts.ts % 97).toString(16)}`,
      srcip: opts.srcIp,
      srcport: opts.srcPort ? String(opts.srcPort) : undefined,
      dstip: opts.dstIp ?? opts.host.ip,
      dstport: opts.dstIp ? String(22 + (opts.ts % 4) * 443) : undefined,
      full_event: opts.fullEvent,
    },
    null,
    0,
  );
}

export function sysmonProcessCreate(opts: {
  ts: number;
  host: HostFixture;
  image: string;
  commandLine: string;
  parent: string;
  user: string;
  hash: string;
}): string {
  return [
    'Provider: Microsoft-Windows-Sysmon Guid={5770385f-cadd-418d-93ff-0691e9d00000}',
    'EventID: 1 Level: 1 Computer: ' + opts.host.hostname + '.corp.local',
    `TimeCreated: ${winTime(opts.ts)}`,
    `Process Create: RuleName: - UtcTime: ${winTime(opts.ts)} ProcessGuid: {${opts.host.agent_id}-0001${opts.ts % 9999}-0000} ` +
      `ProcessId: ${opts.ts % 60000 + 1024} Image: ${opts.image} CommandLine: ${opts.commandLine} ` +
      `CurrentDirectory: C:\\Users\\Public\\ LogonGuid: {A35644C9-0A31-6952-E001-000000000000} TerminalSessionId: 2 ` +
      `User: CORP\\${opts.user} ParentProcessGuid: {${opts.host.agent_id}-0000${opts.ts % 4999}-0000} ParentProcessId: 4820 ` +
      `ParentImage: ${opts.parent} Hashes: SHA256=${opts.hash}`,
  ].join('\n');
}

export function sysmonLsassAccess(opts: {
  ts: number;
  host: HostFixture;
  sourceImage: string;
  user: string;
  granted: string;
}): string {
  return [
    'Provider: Microsoft-Windows-Sysmon Guid={5770385f-cadd-418d-93ff-0691e9d00000}',
    'EventID: 10 Level: 4 Computer: ' + opts.host.hostname + '.corp.local',
    `TimeCreated: ${winTime(opts.ts)}`,
    `Process accessed: RuleName: ACCESS_TO_LSASS UtcTime: ${winTime(opts.ts)} ` +
      `SourceProcessGUID: {B4A2F1C0-0000-1F2E-0000-000000001F2E} SourceProcessId: 3184 ` +
      `SourceImage: ${opts.sourceImage} TargetProcessGUID: {B4A2F1C0-0000-1F2E-0000-0000000003A4} ` +
      `TargetProcessId: 712 TargetImage: C:\\Windows\\System32\\lsass.exe GrantedAccess: ${opts.granted} ` +
      `CallTrace: C:\\WINDOWS\\SYSTEM32\\ntdll.dll+978e3|C:\\WINDOWS\\System32\\KERNELBASE.dll+24f9f User: CORP\\${opts.user}`,
  ].join('\n');
}

export function windowsSecurityEvent(opts: {
  ts: number;
  host: HostFixture;
  eventID: number;
  keywords: string;
  message: string;
  fields: Record<string, string>;
}): string {
  const data = Object.entries(opts.fields)
    .map(([k, v]) => `      ${k}: ${v}`)
    .join('\n');
  return [
    'Provider: Microsoft-Windows-Security-Auditing Guid={54849625-5478-4994-a5ba-3e3b0328c30d}',
    `EventID: ${opts.eventID} Level: 0 Task: ${opts.eventID} Opcode: Info Keywords: ${opts.keywords}`,
    `Computer: ${opts.host.hostname}.corp.local TimeCreated: ${winTime(opts.ts)}`,
    `Message: ${opts.message}`,
    data,
  ].join('\n');
}

export interface DraftEvent {
  timestamp: string;
  source: EventSource;
  event_type: string;
  hostname: string | null;
  username: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  severity: Severity;
  raw: string;
  normalized: Record<string, unknown>;
  demo: boolean;
}

export function draft(partial: DraftEvent): DraftEvent {
  return partial;
}
