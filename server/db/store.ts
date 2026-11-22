import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AuditLogEntry,
  ConsentRecord,
  ConsentScope,
  RuleRecord,
  ThresholdConfig,
  UserRole,
} from '../../src/shared/types';
import { createInitialDatabaseState, type DatabaseState } from './seedData';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'relief-checker-db.json');

export class RelationalStore {
  public state: DatabaseState;
  private persistEnabled: boolean;

  constructor(persistEnabled = true) {
    this.persistEnabled = persistEnabled;
    this.state = this.loadOrInit();
  }

  private loadOrInit(): DatabaseState {
    if (this.persistEnabled && fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.rules)) {
          return parsed;
        }
      } catch {
        // Fallback to clean seed if corrupted
      }
    }
    const fresh = createInitialDatabaseState();
    this.state = fresh;
    this.save();
    return fresh;
  }

  public save(): void {
    if (!this.persistEnabled) return;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  }

  public nextId(prefix: string): string {
    return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
  }

  public getActiveRules(): RuleRecord[] {
    return this.state.rules.filter((r) => r.active);
  }

  public getLatestRuleVersion(): number {
    return this.state.rules.reduce((max, r) => Math.max(max, r.version), 1);
  }

  public getActiveThresholds(): ThresholdConfig {
    const active = this.state.thresholds.find((t) => t.active);
    if (active) return active;
    return this.state.thresholds[this.state.thresholds.length - 1];
  }

  /**
   * Append-only audit log writer. Supports reads, writes, AI decisions, and security/consent events.
   * No update or delete method is exposed.
   */
  public appendAudit(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): AuditLogEntry {
    const full: AuditLogEntry = {
      ...entry,
      id: this.nextId('aud'),
      created_at: new Date().toISOString(),
    };
    this.state.audit_log.unshift(full);
    if (this.state.audit_log.length > 1000) {
      this.state.audit_log = this.state.audit_log.slice(0, 1000);
    }
    this.save();
    return full;
  }

  /**
   * Server-side consent enforcement check.
   * Returns true ONLY if an explicit active consent exists for the subject & scope
   * (or if no consent row exists for a brand-new unlinked scope, defaults to denied when withdrawn).
   */
  public hasActiveConsent(
    subjectType: 'user' | 'family',
    subjectId: string,
    scope: ConsentScope
  ): boolean {
    const matching = this.state.consents.filter(
      (c) => c.subject_type === subjectType && c.subject_id === subjectId && c.scope === scope
    );
    if (matching.length === 0) return false;
    return matching.some((c) => c.status === 'active');
  }

  public ensureFamilyDefaultConsents(
    familyId: string,
    familyName: string,
    ownerUserId: string
  ): ConsentRecord[] {
    const scopes: ConsentScope[] = ['case_review', 'mock_identity', 'mock_payment'];
    const now = new Date().toISOString();
    const created: ConsentRecord[] = [];
    for (const scope of scopes) {
      const exists = this.state.consents.some(
        (c) => c.subject_type === 'family' && c.subject_id === familyId && c.scope === scope
      );
      if (!exists) {
        const rec: ConsentRecord = {
          id: this.nextId('cns'),
          subject_type: 'family',
          subject_id: familyId,
          subject_label: `${familyName} (${familyId})`,
          owner_user_id: ownerUserId,
          grantee_role: 'officer' as UserRole,
          scope,
          status: 'active',
          granted_at: now,
          withdrawn_at: null,
        };
        this.state.consents.push(rec);
        created.push(rec);
      }
    }
    this.save();
    return created;
  }
}
