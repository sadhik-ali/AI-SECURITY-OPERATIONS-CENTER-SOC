import type { EventSource, Severity } from '../types/api';

export interface HostFixture {
  hostname: string;
  ip: string;
  os: string;
  role: string;
  agent_id: string;
}

export const HOSTS: readonly HostFixture[] = [
  { hostname: 'web-01', ip: '10.20.5.11', os: 'Ubuntu 22.04.4 LTS', role: 'nginx reverse proxy', agent_id: '003' },
  { hostname: 'web-02', ip: '10.20.5.12', os: 'Ubuntu 22.04.4 LTS', role: 'app node', agent_id: '004' },
  { hostname: 'db-prod-01', ip: '10.20.7.30', os: 'Debian 12', role: 'PostgreSQL 16 primary', agent_id: '007' },
  { hostname: 'win-dc-01', ip: '10.20.1.5', os: 'Windows Server 2022', role: 'domain controller', agent_id: '002' },
  { hostname: 'jump-01', ip: '10.20.9.8', os: 'Rocky Linux 9', role: 'ssh bastion', agent_id: '005' },
  { hostname: 'L-TP-0142', ip: '10.20.30.61', os: 'Windows 11 Pro 23H2', role: 'finance laptop', agent_id: '011' },
  { hostname: 'L-TP-0221', ip: '10.20.30.87', os: 'Windows 11 Pro 23H2', role: 'engineering laptop', agent_id: '014' },
  { hostname: 'L-TP-0310', ip: '10.20.30.44', os: 'Windows 11 Pro 23H2', role: 'sales laptop', agent_id: '016' },
  { hostname: 'wrk-st-07', ip: '10.20.30.19', os: 'Windows 10 Enterprise', role: 'operations workstation', agent_id: '018' },
  { hostname: 'monitor-01', ip: '10.20.9.20', os: 'Ubuntu 24.04', role: 'wazuh manager / grafana', agent_id: '001' },
];

export const HOST_BY_NAME: Record<string, HostFixture> = Object.fromEntries(
  HOSTS.map((h) => [h.hostname, h]),
);

export interface UserFixture {
  username: string;
  full_name: string;
  department: string;
  privileged: boolean;
}

export const USERS: readonly UserFixture[] = [
  { username: 'a.sardhi', full_name: 'Adnan Sardhi', department: 'SOC', privileged: false },
  { username: 'm.okafor', full_name: 'Micah Okafor', department: 'IT Ops', privileged: false },
  { username: 'j.rivera', full_name: 'Jasmine Rivera', department: 'Finance', privileged: false },
  { username: 't.brooks', full_name: 'Tobias Brooks', department: 'Sales', privileged: false },
  { username: 'l.chen', full_name: 'Lena Chen', department: 'Engineering', privileged: false },
  { username: 'd.novak', full_name: 'Dana Novak', department: 'Engineering', privileged: true },
  { username: 'k.iqbal', full_name: 'Kamran Iqbal', department: 'IT Ops', privileged: true },
  { username: 'svc-backup', full_name: 'Backup service account', department: 'Service', privileged: true },
  { username: 'svc-jenkins', full_name: 'CI service account', department: 'Service', privileged: true },
  { username: 'sqlagent', full_name: 'MSSQL Agent', department: 'Service', privileged: true },
];

export const INTERACTIVE_USERS = USERS.filter((u) => u.department !== 'Service');
export const SERVICE_ACCOUNTS = USERS.filter((u) => u.department === 'Service');

/** Untrusted external addresses — RFC 5737 documentation ranges plus one realistic-looking ASN. */
export const ATTACKER_IPS = [
  '203.0.113.44',
  '203.0.113.98',
  '198.51.100.23',
  '198.51.100.77',
  '185.220.101.7',
  '45.146.164.110',
  '91.219.236.18',
];

export const SEVERITY_WEIGHTS: [Severity, number][] = [
  ['informational', 46],
  ['low', 30],
  ['high', 18],
  ['critical', 6],
];

export const NOISE_SOURCES: [EventSource, number][] = [
  ['wazuh', 42],
  ['linux_auth', 33],
  ['sysmon', 20],
  ['demo_generator', 5],
];

export const TIMEZONE = 'Asia/Karachi';

export const DEMO_ANALYSTS = ['a.sardhi', 'm.okafor', 'd.novak', 'k.iqbal', 'unassigned'];
