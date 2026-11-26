import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Database,
  DuplicateGroup,
  ItemListQuery,
  ItemRecord,
  RateLimitRecord,
  SessionRecord,
  ShareLinkRecord,
  StorageHygieneResult,
  TagRecord,
  UploadRecord,
  UserRecord,
} from './types';
import type { UploadStatus } from '@vault/shared';

interface FileDbState {
  users: UserRecord[];
  sessions: SessionRecord[];
  items: ItemRecord[];
  uploads: UploadRecord[];
  tags: TagRecord[];
  rateLimits: RateLimitRecord[];
  shareLinks: ShareLinkRecord[];
}

const emptyState = (): FileDbState => ({
  users: [],
  sessions: [],
  items: [],
  uploads: [],
  tags: [],
  rateLimits: [],
  shareLinks: [],
});

export class FileDatabase implements Database {
  private state: FileDbState = emptyState();
  private writeQueue: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(private dataDir: string) {}

  private filePath() {
    return path.join(this.dataDir, 'db.json');
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await readFile(this.filePath(), 'utf8');
      this.state = { ...emptyState(), ...JSON.parse(raw) };
    } catch {
      this.state = emptyState();
      await this.persist();
    }
    this.loaded = true;
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      const tmp = this.filePath() + '.tmp';
      await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      await rename(tmp, this.filePath());
    });
    return this.writeQueue;
  }

  async ensureIndexes(): Promise<void> {
    await this.ensureLoaded();
  }

  async findUserByEmail(email: string) {
    await this.ensureLoaded();
    return this.state.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findUserById(id: string) {
    await this.ensureLoaded();
    return this.state.users.find((u) => u._id === id) ?? null;
  }

  async findUserByPasswordResetTokenHash(hash: string) {
    await this.ensureLoaded();
    return this.state.users.find((u) => u.passwordResetTokenHash === hash) ?? null;
  }

  async listUsers(limit = 1) {
    await this.ensureLoaded();
    return this.state.users.slice(0, limit);
  }

  async createUser(user: UserRecord) {
    await this.ensureLoaded();
    if (this.state.users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
      throw new Error('Email already exists');
    }
    this.state.users.push(user);
    await this.persist();
    return user;
  }

  async updateUser(id: string, patch: Partial<UserRecord>) {
    await this.ensureLoaded();
    const idx = this.state.users.findIndex((u) => u._id === id);
    if (idx < 0) return null;
    this.state.users[idx] = { ...this.state.users[idx], ...patch, _id: id };
    await this.persist();
    return this.state.users[idx];
  }

  async countUsers() {
    await this.ensureLoaded();
    return this.state.users.length;
  }

  async createSession(session: SessionRecord) {
    await this.ensureLoaded();
    this.state.sessions.push(session);
    await this.persist();
    return session;
  }

  async findSessionById(id: string) {
    await this.ensureLoaded();
    return this.state.sessions.find((s) => s._id === id) ?? null;
  }

  async deleteSession(id: string) {
    await this.ensureLoaded();
    this.state.sessions = this.state.sessions.filter((s) => s._id !== id);
    await this.persist();
  }

  async deleteSessionsForUser(userId: string) {
    await this.ensureLoaded();
    this.state.sessions = this.state.sessions.filter((s) => s.userId !== userId);
    await this.persist();
  }

  async createItem(item: ItemRecord) {
    await this.ensureLoaded();
    this.state.items.push(item);
    await this.persist();
    return item;
  }

  async findItemById(userId: string, id: string) {
    await this.ensureLoaded();
    return this.state.items.find((i) => i._id === id && i.userId === userId) ?? null;
  }

  async findItemByIdempotency(userId: string, key: string) {
    await this.ensureLoaded();
    return this.state.items.find((i) => i.userId === userId && i.idempotencyKey === key) ?? null;
  }

  async findItemByContentHash(userId: string, hash: string) {
    await this.ensureLoaded();
    return (
      this.state.items.find(
        (i) => i.userId === userId && i.contentHash === hash && !i.trashed,
      ) ?? null
    );
  }

  async findItemByUrl(userId: string, url: string) {
    await this.ensureLoaded();
    return this.state.items.find((i) => i.userId === userId && i.url === url) ?? null;
  }

  async updateItem(userId: string, id: string, patch: Partial<ItemRecord>) {
    await this.ensureLoaded();
    const idx = this.state.items.findIndex((i) => i._id === id && i.userId === userId);
    if (idx < 0) return null;
    this.state.items[idx] = { ...this.state.items[idx], ...patch, _id: id, userId };
    await this.persist();
    return this.state.items[idx];
  }

  async deleteItem(userId: string, id: string) {
    await this.ensureLoaded();
    const before = this.state.items.length;
    this.state.items = this.state.items.filter((i) => !(i._id === id && i.userId === userId));
    await this.persist();
    return this.state.items.length < before;
  }

  async listItems(query: ItemListQuery) {
    await this.ensureLoaded();
    let items = this.state.items.filter((i) => i.userId === query.userId);

    if (query.trashed === true) items = items.filter((i) => i.trashed === true);
    else items = items.filter((i) => i.trashed !== true);

    if (query.archived === true) items = items.filter((i) => i.archived);
    else if (query.archived === false) items = items.filter((i) => !i.archived);

    if (query.favorite === true) items = items.filter((i) => i.favorite);
    if (query.inbox === true) items = items.filter((i) => i.inbox !== false);
    else if (query.inbox === false) items = items.filter((i) => i.inbox === false);
    if (query.locked === true) items = items.filter((i) => i.locked);
    else if (query.locked === false) items = items.filter((i) => !i.locked);
    if (query.due === true) {
      const now = new Date().toISOString();
      items = items.filter((i) => i.reminderAt != null && i.reminderAt <= now);
    }
    if (query.contentType) items = items.filter((i) => i.contentType === query.contentType);
    if (query.tags?.length) {
      items = items.filter((i) => query.tags!.every((t) => i.tags.includes(t)));
    }
    if (query.from) items = items.filter((i) => i.createdAt >= query.from!);
    if (query.to) items = items.filter((i) => i.createdAt <= query.to!);
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((i) => {
        const hay = [
          i.title,
          i.description || '',
          i.url || '',
          i.fileName || '',
          i.notes || '',
          i.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const sort = query.sort || 'newest';
    items = [...items].sort((a, b) => {
      if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      if (sort === 'name') return a.title.localeCompare(b.title);
      if (sort === 'size') return (b.fileSize || 0) - (a.fileSize || 0);
      return b.createdAt.localeCompare(a.createdAt);
    });

    const total = items.length;
    let start = 0;
    if (query.cursor) {
      const idx = items.findIndex((i) => i._id === query.cursor);
      start = idx >= 0 ? idx + 1 : 0;
    }
    const page = items.slice(start, start + query.limit);
    const nextCursor = start + query.limit < items.length ? page[page.length - 1]?._id : undefined;
    return { items: page, nextCursor, total };
  }

  async countItems(
    userId: string,
    filter: Partial<Pick<ItemRecord, 'contentType' | 'favorite' | 'archived' | 'trashed' | 'status'>> = {},
  ) {
    await this.ensureLoaded();
    return this.state.items.filter((i) => {
      if (i.userId !== userId) return false;
      if (filter.contentType && i.contentType !== filter.contentType) return false;
      if (filter.favorite != null && i.favorite !== filter.favorite) return false;
      if (filter.archived != null && i.archived !== filter.archived) return false;
      if (filter.trashed != null && i.trashed !== filter.trashed) return false;
      if (filter.status && i.status !== filter.status) return false;
      return true;
    }).length;
  }

  async bulkUpdateItems(userId: string, ids: string[], patch: Partial<ItemRecord>) {
    await this.ensureLoaded();
    let n = 0;
    const set = new Set(ids);
    this.state.items = this.state.items.map((i) => {
      if (i.userId === userId && set.has(i._id)) {
        n++;
        return { ...i, ...patch, _id: i._id, userId };
      }
      return i;
    });
    await this.persist();
    return n;
  }

  async sumFileSizes(userId: string) {
    await this.ensureLoaded();
    return this.state.items
      .filter((i) => i.userId === userId && !i.trashed && i.objectKey && i.fileSize)
      .reduce((sum, i) => sum + (i.fileSize || 0), 0);
  }

  async largestFiles(userId: string, limit: number) {
    await this.ensureLoaded();
    return this.state.items
      .filter((i) => i.userId === userId && !i.trashed && (i.fileSize || 0) > 0)
      .sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0))
      .slice(0, limit);
  }

  async listDueItems(userId: string) {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    return this.state.items
      .filter((i) => i.userId === userId && !i.trashed && i.reminderAt != null && i.reminderAt <= now)
      .sort((a, b) => (a.reminderAt || '').localeCompare(b.reminderAt || ''));
  }

  async getStorageHygiene(userId: string, limit = 10): Promise<StorageHygieneResult> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const archiveThreshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const userItems = this.state.items.filter((i) => i.userId === userId);

    const largestFiles = await this.largestFiles(userId, limit);

    const unusedArchiveCandidates = userItems
      .filter((i) => i.archived && !i.trashed && i.updatedAt <= archiveThreshold)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

    const trashCount = userItems.filter((i) => i.trashed).length;

    const expiredItems = userItems
      .filter((i) => !i.trashed && i.expiresAt != null && i.expiresAt <= now)
      .sort((a, b) => (a.expiresAt || '').localeCompare(b.expiresAt || ''));

    const byHash = new Map<string, ItemRecord[]>();
    for (const i of userItems) {
      if (i.trashed || !i.contentHash) continue;
      const arr = byHash.get(i.contentHash) || [];
      arr.push(i);
      byHash.set(i.contentHash, arr);
    }
    const duplicateGroups: DuplicateGroup[] = [...byHash.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([contentHash, items]) => ({ contentHash, count: items.length, items }));

    return { largestFiles, unusedArchiveCandidates, trashCount, expiredItems, duplicateGroups };
  }

  async createShareLink(link: ShareLinkRecord) {
    await this.ensureLoaded();
    this.state.shareLinks.push(link);
    await this.persist();
    return link;
  }

  async findShareLinkById(userId: string, id: string) {
    await this.ensureLoaded();
    return this.state.shareLinks.find((s) => s._id === id && s.userId === userId) ?? null;
  }

  async findShareLinkByTokenHash(tokenHash: string) {
    await this.ensureLoaded();
    return this.state.shareLinks.find((s) => s.tokenHash === tokenHash) ?? null;
  }

  async listShareLinksForItem(userId: string, itemId: string) {
    await this.ensureLoaded();
    return this.state.shareLinks.filter((s) => s.userId === userId && s.itemId === itemId);
  }

  async revokeShareLink(userId: string, id: string) {
    await this.ensureLoaded();
    const idx = this.state.shareLinks.findIndex((s) => s._id === id && s.userId === userId);
    if (idx < 0) return null;
    this.state.shareLinks[idx] = {
      ...this.state.shareLinks[idx],
      revokedAt: new Date().toISOString(),
    };
    await this.persist();
    return this.state.shareLinks[idx];
  }

  async createUpload(upload: UploadRecord) {
    await this.ensureLoaded();
    this.state.uploads.push(upload);
    await this.persist();
    return upload;
  }

  async findUploadById(userId: string, id: string) {
    await this.ensureLoaded();
    return this.state.uploads.find((u) => u._id === id && u.userId === userId) ?? null;
  }

  async findUploadByIdempotency(userId: string, key: string) {
    await this.ensureLoaded();
    return this.state.uploads.find((u) => u.userId === userId && u.idempotencyKey === key) ?? null;
  }

  async updateUpload(userId: string, id: string, patch: Partial<UploadRecord>) {
    await this.ensureLoaded();
    const idx = this.state.uploads.findIndex((u) => u._id === id && u.userId === userId);
    if (idx < 0) return null;
    this.state.uploads[idx] = { ...this.state.uploads[idx], ...patch, _id: id, userId };
    await this.persist();
    return this.state.uploads[idx];
  }

  async listUploads(userId: string, status?: UploadStatus[]) {
    await this.ensureLoaded();
    return this.state.uploads.filter(
      (u) => u.userId === userId && (!status || status.includes(u.status)),
    );
  }

  async deleteUpload(userId: string, id: string) {
    await this.ensureLoaded();
    this.state.uploads = this.state.uploads.filter((u) => !(u._id === id && u.userId === userId));
    await this.persist();
  }

  async listTags(userId: string) {
    await this.ensureLoaded();
    return this.state.tags.filter((t) => t.userId === userId);
  }

  async findTagByName(userId: string, name: string) {
    await this.ensureLoaded();
    return (
      this.state.tags.find(
        (t) => t.userId === userId && t.name.toLowerCase() === name.toLowerCase(),
      ) ?? null
    );
  }

  async createTag(tag: TagRecord) {
    await this.ensureLoaded();
    this.state.tags.push(tag);
    await this.persist();
    return tag;
  }

  async updateTag(userId: string, id: string, patch: Partial<TagRecord>) {
    await this.ensureLoaded();
    const idx = this.state.tags.findIndex((t) => t._id === id && t.userId === userId);
    if (idx < 0) return null;
    this.state.tags[idx] = { ...this.state.tags[idx], ...patch, _id: id, userId };
    await this.persist();
    return this.state.tags[idx];
  }

  async deleteTag(userId: string, id: string) {
    await this.ensureLoaded();
    const before = this.state.tags.length;
    this.state.tags = this.state.tags.filter((t) => !(t._id === id && t.userId === userId));
    await this.persist();
    return this.state.tags.length < before;
  }

  async purgeUserData(userId: string) {
    await this.ensureLoaded();
    const objectKeys = this.state.items
      .filter((i) => i.userId === userId && typeof i.objectKey === 'string' && i.objectKey)
      .map((i) => i.objectKey!) as string[];
    const before = this.state.items.length;
    this.state.items = this.state.items.filter((i) => i.userId !== userId);
    this.state.uploads = this.state.uploads.filter((u) => u.userId !== userId);
    this.state.tags = this.state.tags.filter((t) => t.userId !== userId);
    this.state.shareLinks = this.state.shareLinks.filter((s) => s.userId !== userId);
    const user = this.state.users.find((u) => u._id === userId);
    if (user) {
      user.storageUsedBytes = 0;
      user.storageReservedBytes = 0;
      user.updatedAt = new Date().toISOString();
    }
    await this.persist();
    return { deletedItems: before - this.state.items.length, objectKeys };
  }

  async reserveStorage(userId: string, bytes: number, quotaBytes: number) {
    await this.ensureLoaded();
    const user = this.state.users.find((u) => u._id === userId);
    if (!user) return false;
    if (user.storageUsedBytes + user.storageReservedBytes + bytes > quotaBytes) return false;
    user.storageReservedBytes += bytes;
    user.updatedAt = new Date().toISOString();
    await this.persist();
    return true;
  }

  async releaseReservation(userId: string, bytes: number) {
    await this.ensureLoaded();
    const user = this.state.users.find((u) => u._id === userId);
    if (!user) return;
    user.storageReservedBytes = Math.max(0, user.storageReservedBytes - bytes);
    user.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async commitReservation(userId: string, reservedBytes: number, actualBytes: number) {
    await this.ensureLoaded();
    const user = this.state.users.find((u) => u._id === userId);
    if (!user) return;
    user.storageReservedBytes = Math.max(0, user.storageReservedBytes - reservedBytes);
    user.storageUsedBytes += actualBytes;
    user.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async hitRateLimit(key: string, limit: number, windowMs: number) {
    await this.ensureLoaded();
    const now = Date.now();
    let rec = this.state.rateLimits.find((r) => r._id === key);
    if (!rec || new Date(rec.resetAt).getTime() <= now) {
      rec = {
        _id: key,
        count: 1,
        resetAt: new Date(now + windowMs).toISOString(),
      };
      this.state.rateLimits = this.state.rateLimits.filter((r) => r._id !== key);
      this.state.rateLimits.push(rec);
      await this.persist();
      return { allowed: true, remaining: limit - 1 };
    }
    rec.count += 1;
    await this.persist();
    return { allowed: rec.count <= limit, remaining: Math.max(0, limit - rec.count) };
  }

  async close() {
    await this.writeQueue;
  }
}
