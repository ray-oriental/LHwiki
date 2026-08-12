// Local persistence stays near-instant; cloud writes are coalesced until the
// writer pauses, which keeps the editor responsive without charging per keypress.
const SAVE_DELAY = 4000;
const LOCAL_DELAY = 220;
const RETRY_DELAYS = [2000, 5000, 15000, 30000];

function storageKey(userId, draftKey) {
  return `lhwiki:draft:${encodeURIComponent(userId)}:${encodeURIComponent(draftKey)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fingerprint(value) {
  return JSON.stringify(value);
}

export function draftKeyFor(targetType, targetId = null) {
  if (targetType === 'submission') return `submission:${targetId}`;
  if (targetType === 'article') return `article:${targetId}`;
  return `new:${crypto.randomUUID()}`;
}

export function readLocalDraft(userId, draftKey) {
  try {
    const raw = localStorage.getItem(storageKey(userId, draftKey));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.snapshot ? parsed : null;
  } catch {
    return null;
  }
}

export function clearLocalDraft(userId, draftKey) {
  try { localStorage.removeItem(storageKey(userId, draftKey)); } catch { /* private mode can disable storage */ }
}

export function clearUserLocalDrafts(userId) {
  try {
    const prefix = `lhwiki:draft:${encodeURIComponent(userId)}:`;
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch { /* logout should still succeed when storage is unavailable */ }
}

export class DraftManager {
  constructor({ api, userId, draftKey, targetType = 'new', targetId = null, draft = null, onState = () => {}, onConflict = () => {} }) {
    this.api = api;
    this.userId = userId;
    this.draftKey = draft?.draftKey || draftKey;
    this.targetType = draft?.targetType || targetType;
    this.targetId = draft?.targetId || targetId;
    this.id = draft?.id || null;
    this.revision = draft?.revision || null;
    this.snapshot = draft ? this.snapshotFromDraft(draft) : null;
    this.snapshotFingerprint = this.snapshot ? fingerprint(this.snapshot) : null;
    this.updatedAt = draft?.updatedAt || null;
    this.onState = onState;
    this.onConflict = onConflict;
    this.sequence = 0;
    this.savedSequence = 0;
    this.saving = null;
    this.timer = null;
    this.localTimer = null;
    this.retryTimer = null;
    this.retryIndex = 0;
    this.conflicted = false;
    this.removing = false;
    this.lastState = 'saved';
    this.channel = this.createChannel();
    this.onlineHandler = () => this.sequence > this.savedSequence && this.saveNow();
    window.addEventListener('online', this.onlineHandler);
    this.pagehideHandler = () => this.persistLocal(true);
    window.addEventListener('pagehide', this.pagehideHandler);
    this.setState('saved', this.updatedAt ? `已保存于 ${this.formatTime(this.updatedAt)}` : '尚未开始保存');
  }

  snapshotFromDraft(draft) {
    return {
      sectionSlug: draft.sectionSlug || '',
      contentType: draft.contentType || '',
      title: draft.title || '',
      summary: draft.summary || '',
      subject: draft.subject || '',
      authorLabel: draft.authorLabel || '',
      anonymous: Boolean(draft.anonymous),
      body: clone(draft.body || [])
    };
  }

  createChannel() {
    if (!('BroadcastChannel' in window)) return null;
    const channel = new BroadcastChannel(`lhwiki:${this.userId}:${this.draftKey}`);
    channel.addEventListener('message', event => {
      if (event.data?.revision > (this.revision || 0)) this.setState('dirty', '另一页面保存了更新，继续书写时会进行版本检查');
    });
    return channel;
  }

  local() {
    return readLocalDraft(this.userId, this.draftKey);
  }

  chooseInitial(initialSnapshot) {
    const local = this.local();
    if (local && (!this.updatedAt || Date.parse(local.savedAt) > Date.parse(this.updatedAt))) {
      this.snapshot = clone(local.snapshot);
      this.snapshotFingerprint = fingerprint(this.snapshot);
      this.sequence = Number(local.sequence) || 1;
      this.savedSequence = Number(local.savedSequence) || 0;
      this.id = this.id || local.draftId || null;
      this.revision = this.revision || local.revision || null;
      this.setState('dirty', '已恢复这台设备上较新的内容');
      queueMicrotask(() => this.saveNow());
      return clone(this.snapshot);
    }
    this.snapshot = clone(this.snapshot || initialSnapshot);
    this.snapshotFingerprint = fingerprint(this.snapshot);
    return clone(this.snapshot);
  }

  update(snapshot) {
    const nextSnapshot = clone(snapshot);
    const nextFingerprint = fingerprint(nextSnapshot);
    if (nextFingerprint === this.snapshotFingerprint) return false;
    this.snapshot = nextSnapshot;
    this.snapshotFingerprint = nextFingerprint;
    this.sequence += 1;
    this.setState(navigator.onLine ? 'dirty' : 'offline', navigator.onLine ? '有修改尚未保存' : '离线：已保存在这台设备');
    clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => this.persistLocal(), LOCAL_DELAY);
    clearTimeout(this.timer);
    if (!this.conflicted && navigator.onLine) this.timer = setTimeout(() => this.saveNow(), SAVE_DELAY);
    return true;
  }

  persistLocal(sync = false) {
    clearTimeout(this.localTimer);
    if (!this.snapshot) return;
    try {
      localStorage.setItem(storageKey(this.userId, this.draftKey), JSON.stringify({
        snapshot: this.snapshot,
        savedAt: new Date().toISOString(),
        sequence: this.sequence,
        savedSequence: this.savedSequence,
        draftId: this.id,
        revision: this.revision
      }));
    } catch {
      if (!sync) this.setState('failed', '浏览器无法写入本机恢复副本');
    }
  }

  async saveNow() {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.persistLocal();
    if (!this.snapshot || this.conflicted) return null;
    if (!navigator.onLine) {
      this.setState('offline', '离线：已保存在这台设备');
      return null;
    }
    if (this.saving) {
      await this.saving;
      if (this.sequence > this.savedSequence) return this.saveNow();
      return null;
    }
    const sendingSequence = this.sequence;
    const sendingSnapshot = clone(this.snapshot);
    this.setState('saving', '正在保存到云端…');
    this.saving = this.performSave(sendingSnapshot, sendingSequence);
    try {
      return await this.saving;
    } finally {
      this.saving = null;
    }
  }

  async performSave(snapshot, sendingSequence) {
    try {
      const wasNew = !this.id;
      let response = wasNew
        ? await this.api('/api/drafts', { method: 'POST', body: { draftKey: this.draftKey, targetType: this.targetType, targetId: this.targetId, snapshot } })
        : await this.api(`/api/drafts/${encodeURIComponent(this.id)}`, { method: 'PUT', body: { expectedRevision: this.revision, snapshot } });
      let draft = response.draft;
      if (wasNew && JSON.stringify(this.snapshotFromDraft(draft)) !== JSON.stringify(snapshot)) {
        response = await this.api(`/api/drafts/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: { expectedRevision: draft.revision, snapshot } });
        draft = response.draft;
      }
      this.id = draft.id;
      this.draftKey = draft.draftKey;
      this.revision = draft.revision;
      this.updatedAt = draft.updatedAt;
      this.savedSequence = Math.max(this.savedSequence, sendingSequence);
      this.retryIndex = 0;
      this.channel?.postMessage({ revision: this.revision, updatedAt: this.updatedAt });
      this.persistLocal();
      if (this.sequence === this.savedSequence) this.setState('saved', `已保存 ${this.formatTime(this.updatedAt)}`);
      else this.setState('dirty', '保存期间有新修改，正在继续保存');
      return draft;
    } catch (error) {
      if (this.removing) return null;
      if (error.status === 409 && error.data?.conflict) {
        this.conflicted = true;
        this.setState('conflict', '这份草稿已在其他页面更新');
        this.onConflict(error.data.conflict, clone(this.snapshot));
        return null;
      }
      this.setState(navigator.onLine ? 'failed' : 'offline', navigator.onLine ? '云端保存失败，将自动重试' : '离线：已保存在这台设备');
      const delay = RETRY_DELAYS[Math.min(this.retryIndex++, RETRY_DELAYS.length - 1)];
      this.retryTimer = setTimeout(() => this.saveNow(), delay);
      return null;
    }
  }

  async submit() {
    await this.saveNow();
    if (this.conflicted) throw new Error('请先处理草稿冲突');
    if (this.sequence !== this.savedSequence || ['failed', 'offline'].includes(this.lastState)) throw new Error('最新修改尚未保存到云端，请检查网络后重试');
    if (!this.id || !this.revision) throw new Error('草稿还没有保存到云端，请重试');
    const result = await this.api(`/api/drafts/${encodeURIComponent(this.id)}/submit`, {
      method: 'POST',
      body: { expectedRevision: this.revision }
    });
    clearLocalDraft(this.userId, this.draftKey);
    return result;
  }

  async remove() {
    this.removing = true;
    clearTimeout(this.timer);
    clearTimeout(this.localTimer);
    clearTimeout(this.retryTimer);
    if (this.saving) await this.saving;
    if (this.id) await this.api(`/api/drafts/${encodeURIComponent(this.id)}`, { method: 'DELETE' });
    clearLocalDraft(this.userId, this.draftKey);
    this.snapshot = null;
    this.snapshotFingerprint = null;
    this.id = null;
    this.revision = null;
    this.sequence = 0;
    this.savedSequence = 0;
  }

  adoptCloud(draft) {
    this.id = draft.id;
    this.draftKey = draft.draftKey;
    this.revision = draft.revision;
    this.updatedAt = draft.updatedAt;
    this.snapshot = this.snapshotFromDraft(draft);
    this.snapshotFingerprint = fingerprint(this.snapshot);
    this.sequence += 1;
    this.savedSequence = this.sequence;
    this.conflicted = false;
    this.persistLocal();
    this.setState('saved', `已采用云端版本 ${this.formatTime(this.updatedAt)}`);
    return clone(this.snapshot);
  }

  async keepLocalAsCopy(snapshot) {
    const previousDraftKey = this.draftKey;
    this.id = null;
    this.revision = null;
    this.targetType = 'new';
    this.targetId = null;
    this.draftKey = draftKeyFor('new');
    clearLocalDraft(this.userId, previousDraftKey);
    this.channel?.close();
    this.channel = this.createChannel();
    this.snapshot = clone(snapshot);
    this.snapshotFingerprint = fingerprint(this.snapshot);
    this.sequence += 1;
    this.savedSequence = 0;
    this.conflicted = false;
    this.persistLocal();
    await this.saveNow();
  }

  setState(state, message) {
    this.lastState = state;
    this.onState({ state, message, updatedAt: this.updatedAt, revision: this.revision });
  }

  formatTime(value) {
    const time = value ? new Date(value) : new Date();
    return Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.localTimer);
    clearTimeout(this.retryTimer);
    this.channel?.close();
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('pagehide', this.pagehideHandler);
  }
}
