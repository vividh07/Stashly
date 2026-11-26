import { MongoClient, type Collection, type Db } from 'mongodb';
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

export class MongoDatabase implements Database {
  private client: MongoClient;
  private db!: Db;
  private users!: Collection<UserRecord>;
  private sessions!: Collection<SessionRecord>;
  private items!: Collection<ItemRecord>;
  private uploads!: Collection<UploadRecord>;
  private tags!: Collection<TagRecord>;
  private rateLimits!: Collection<RateLimitRecord>;
  private shareLinks!: Collection<ShareLinkRecord>;

  constructor(uri: string, private dbName = 'personal_vault') {
    this.client = new MongoClient(uri, {
      maxPoolSize: 1,
      minPoolSize: 0,
      maxIdleTimeMS: 20_000,
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    });
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.users = this.db.collection('users');
    this.sessions = this.db.collection('sessions');
    this.items = this.db.collection('items');
    this.uploads = this.db.collection('uploads');
    this.tags = this.db.collection('tags');
    this.rateLimits = this.db.collection('rate_limits');
    this.shareLinks = this.db.collection('share_links');
  }

  async ensureIndexes() {
    await Promise.all([
      this.users.createIndex({ email: 1 }, { unique: true }),
      this.sessions.createIndex({ userId: 1 }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.items.createIndex({ userId: 1, createdAt: -1 }),
      this.items.createIndex({ userId: 1, contentType: 1, createdAt: -1 }),
      this.items.createIndex({ userId: 1, tags: 1 }),
      this.items.createIndex({ userId: 1, favorite: 1 }),
      this.items.createIndex({ userId: 1, archived: 1, trashed: 1 }),
      this.items.createIndex({ userId: 1, idempotencyKey: 1 }, { sparse: true }),
      this.items.createIndex({ userId: 1, contentHash: 1 }, { sparse: true }),
      this.items.createIndex({ userId: 1, url: 1 }, { sparse: true }),
      this.items.createIndex({ userId: 1, reminderAt: 1 }, { sparse: true }),
      this.items.createIndex({ userId: 1, expiresAt: 1 }, { sparse: true }),
      this.items.createIndex({ userId: 1, inbox: 1 }, { sparse: true }),
      this.items.createIndex(
        {
          title: 'text',
          description: 'text',
          notes: 'text',
          url: 'text',
          fileName: 'text',
          tags: 'text',
        },
        {
          name: 'items_text_search',
          weights: { title: 10, tags: 8, fileName: 6, description: 4, notes: 3, url: 2 },
        },
      ),
      this.uploads.createIndex({ userId: 1, status: 1 }),
      this.uploads.createIndex({ userId: 1, idempotencyKey: 1 }, { sparse: true }),
      this.uploads.createIndex({ expiresAt: 1 }),
      this.tags.createIndex({ userId: 1, name: 1 }, { unique: true }),
      this.rateLimits.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }),
      this.shareLinks.createIndex({ tokenHash: 1 }, { unique: true }),
      this.shareLinks.createIndex({ userId: 1, itemId: 1 }),
      this.shareLinks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  }

  async findUserByEmail(email: string) {
    return this.users.findOne({ email: email.toLowerCase() });
  }

  async findUserById(id: string) {
    return this.users.findOne({ _id: id });
  }

  async findUserByPasswordResetTokenHash(hash: string) {
    return this.users.findOne({ passwordResetTokenHash: hash });
  }

  async listUsers(limit = 1) {
    return this.users.find({}).limit(limit).toArray();
  }

  async createUser(user: UserRecord) {
    await this.users.insertOne({ ...user, email: user.email.toLowerCase() });
    return user;
  }

  async updateUser(id: string, patch: Partial<UserRecord>) {
    const res = await this.users.findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
    return res;
  }

  async countUsers() {
    return this.users.countDocuments();
  }

  async createSession(session: SessionRecord) {
    await this.sessions.insertOne(session);
    return session;
  }

  async findSessionById(id: string) {
    return this.sessions.findOne({ _id: id });
  }

  async deleteSession(id: string) {
    await this.sessions.deleteOne({ _id: id });
  }

  async deleteSessionsForUser(userId: string) {
    await this.sessions.deleteMany({ userId });
  }

  async createItem(item: ItemRecord) {
    await this.items.insertOne(item);
    return item;
  }

  async findItemById(userId: string, id: string) {
    return this.items.findOne({ _id: id, userId });
  }

  async findItemByIdempotency(userId: string, key: string) {
    return this.items.findOne({ userId, idempotencyKey: key });
  }

  async findItemByContentHash(userId: string, hash: string) {
    return this.items.findOne({ userId, contentHash: hash, trashed: { $ne: true } });
  }

  async findItemByUrl(userId: string, url: string) {
    return this.items.findOne({ userId, url });
  }

  async updateItem(userId: string, id: string, patch: Partial<ItemRecord>) {
    // Avoid findOneAndUpdate return-shape differences across driver versions
    // (v5 ModifyResult.value vs v6 document|null) which made trash always 404.
    const { _id: _ignoreId, userId: _ignoreUser, ...rest } = patch as Partial<ItemRecord> & {
      _id?: string;
      userId?: string;
    };
    const updatedAt = new Date().toISOString();
    const result = await this.items.updateOne(
      { _id: id, userId },
      { $set: { ...rest, updatedAt } },
    );
    if (result.matchedCount === 0) return null;
    return this.items.findOne({ _id: id, userId });
  }

  async deleteItem(userId: string, id: string) {
    const res = await this.items.deleteOne({ _id: id, userId });
    return res.deletedCount > 0;
  }

  async listItems(query: ItemListQuery) {
    const filter: Record<string, unknown> = { userId: query.userId };

    if (query.trashed === true) filter.trashed = true;
    else if (query.trashed === false) filter.trashed = { $ne: true };
    else filter.trashed = { $ne: true };

    if (query.archived === true) filter.archived = true;
    else if (query.archived === false) filter.archived = false;

    if (query.favorite === true) filter.favorite = true;
    // Legacy items (no inbox field) count as inbox until Keep/archive clears them.
    if (query.inbox === true) filter.inbox = { $ne: false };
    else if (query.inbox === false) filter.inbox = false;
    if (query.locked === true) filter.locked = true;
    else if (query.locked === false) filter.locked = { $ne: true };
    if (query.due === true) {
      filter.reminderAt = { $ne: null, $lte: new Date().toISOString() };
    }
    if (query.contentType) filter.contentType = query.contentType;
    if (query.tags?.length) filter.tags = { $all: query.tags };
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    let useText = false;
    if (query.q) {
      // Prefer text index; fall back to regex OR for short queries
      if (query.q.trim().length >= 2) {
        filter.$text = { $search: query.q };
        useText = true;
      } else {
        const rx = new RegExp(escapeRegex(query.q), 'i');
        filter.$or = [
          { title: rx },
          { description: rx },
          { notes: rx },
          { url: rx },
          { fileName: rx },
          { tags: rx },
        ];
      }
    }

    const sort: Record<string, 1 | -1 | { $meta: 'textScore' }> =
      query.sort === 'oldest'
        ? { createdAt: 1 }
        : query.sort === 'name'
          ? { title: 1 }
          : query.sort === 'size'
            ? { fileSize: -1 }
            : useText
              ? { score: { $meta: 'textScore' }, createdAt: -1 }
              : { createdAt: -1 };

    const total = await this.items.countDocuments(filter);
    const cursorFilter: Record<string, unknown> = { ...filter };

    if (query.cursor) {
      const [ts, id] = query.cursor.split('|');
      if (ts && id) {
        if (query.sort === 'oldest') {
          cursorFilter.$or = [{ createdAt: { $gt: ts } }, { createdAt: ts, _id: { $gt: id } }];
        } else if (!query.sort || query.sort === 'newest') {
          cursorFilter.$or = [{ createdAt: { $lt: ts } }, { createdAt: ts, _id: { $lt: id } }];
        }
      }
    }

    const findCursor = this.items.find(cursorFilter);
    if (useText) findCursor.project({ score: { $meta: 'textScore' } });
    const items = await findCursor.sort(sort).limit(query.limit).toArray();

    const last = items[items.length - 1];
    const nextCursor =
      items.length === query.limit && last ? `${last.createdAt}|${last._id}` : undefined;

    return { items, nextCursor, total };
  }

  async countItems(userId: string, filter = {}) {
    return this.items.countDocuments({ userId, ...filter });
  }

  async bulkUpdateItems(userId: string, ids: string[], patch: Partial<ItemRecord>) {
    const res = await this.items.updateMany(
      { userId, _id: { $in: ids } },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
    );
    return res.modifiedCount;
  }

  async sumFileSizes(userId: string) {
    const res = await this.items
      .aggregate<{ total: number }>([
        {
          $match: {
            userId,
            trashed: { $ne: true },
            objectKey: { $exists: true, $ne: null },
            fileSize: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: '$fileSize' } } },
      ])
      .toArray();
    return res[0]?.total || 0;
  }

  async largestFiles(userId: string, limit: number) {
    return this.items
      .find({ userId, trashed: { $ne: true }, fileSize: { $gt: 0 } })
      .sort({ fileSize: -1 })
      .limit(limit)
      .toArray();
  }

  async listDueItems(userId: string) {
    const now = new Date().toISOString();
    return this.items
      .find({ userId, trashed: { $ne: true }, reminderAt: { $ne: null, $lte: now } })
      .sort({ reminderAt: 1 })
      .toArray();
  }

  async getStorageHygiene(userId: string, limit = 10): Promise<StorageHygieneResult> {
    const now = new Date().toISOString();
    const archiveThreshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [largestFiles, unusedArchiveCandidates, trashCount, expiredItems, duplicateGroups] =
      await Promise.all([
        this.largestFiles(userId, limit),
        this.items
          .find({ userId, archived: true, trashed: { $ne: true }, updatedAt: { $lte: archiveThreshold } })
          .sort({ updatedAt: 1 })
          .toArray(),
        this.items.countDocuments({ userId, trashed: true }),
        this.items
          .find({ userId, trashed: { $ne: true }, expiresAt: { $ne: null, $lte: now } })
          .sort({ expiresAt: 1 })
          .toArray(),
        this.items
          .aggregate<DuplicateGroup>([
            { $match: { userId, trashed: { $ne: true }, contentHash: { $ne: null } } },
            { $group: { _id: '$contentHash', items: { $push: '$$ROOT' }, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $project: { _id: 0, contentHash: '$_id', count: 1, items: 1 } },
          ])
          .toArray(),
      ]);

    return { largestFiles, unusedArchiveCandidates, trashCount, expiredItems, duplicateGroups };
  }

  async createShareLink(link: ShareLinkRecord) {
    await this.shareLinks.insertOne(link);
    return link;
  }

  async findShareLinkById(userId: string, id: string) {
    return this.shareLinks.findOne({ _id: id, userId });
  }

  async findShareLinkByTokenHash(tokenHash: string) {
    return this.shareLinks.findOne({ tokenHash });
  }

  async listShareLinksForItem(userId: string, itemId: string) {
    return this.shareLinks.find({ userId, itemId }).sort({ createdAt: -1 }).toArray();
  }

  async revokeShareLink(userId: string, id: string) {
    return this.shareLinks.findOneAndUpdate(
      { _id: id, userId },
      { $set: { revokedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
  }

  async createUpload(upload: UploadRecord) {
    await this.uploads.insertOne(upload);
    return upload;
  }

  async findUploadById(userId: string, id: string) {
    return this.uploads.findOne({ _id: id, userId });
  }

  async findUploadByIdempotency(userId: string, key: string) {
    return this.uploads.findOne({ userId, idempotencyKey: key });
  }

  async updateUpload(userId: string, id: string, patch: Partial<UploadRecord>) {
    return this.uploads.findOneAndUpdate(
      { _id: id, userId },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
  }

  async listUploads(userId: string, status?: UploadStatus[]) {
    const filter: Record<string, unknown> = { userId };
    if (status?.length) filter.status = { $in: status };
    return this.uploads.find(filter).sort({ createdAt: -1 }).toArray();
  }

  async deleteUpload(userId: string, id: string) {
    await this.uploads.deleteOne({ _id: id, userId });
  }

  async listTags(userId: string) {
    return this.tags.find({ userId }).sort({ name: 1 }).toArray();
  }

  async findTagByName(userId: string, name: string) {
    return this.tags.findOne({ userId, name: name.toLowerCase() });
  }

  async createTag(tag: TagRecord) {
    await this.tags.insertOne({ ...tag, name: tag.name.toLowerCase() });
    return tag;
  }

  async updateTag(userId: string, id: string, patch: Partial<TagRecord>) {
    return this.tags.findOneAndUpdate(
      { _id: id, userId },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
  }

  async deleteTag(userId: string, id: string) {
    const res = await this.tags.deleteOne({ _id: id, userId });
    return res.deletedCount > 0;
  }

  async purgeUserData(userId: string) {
    const items = await this.items
      .find({ userId, objectKey: { $exists: true, $ne: null } })
      .project({ objectKey: 1 })
      .toArray();
    const objectKeys = items
      .map((i) => i.objectKey)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    const deleted = await this.items.deleteMany({ userId });
    await Promise.all([
      this.uploads.deleteMany({ userId }),
      this.tags.deleteMany({ userId }),
      this.shareLinks.deleteMany({ userId }),
      this.users.updateOne(
        { _id: userId },
        {
          $set: {
            storageUsedBytes: 0,
            storageReservedBytes: 0,
            updatedAt: new Date().toISOString(),
          },
        },
      ),
    ]);

    return { deletedItems: deleted.deletedCount || 0, objectKeys };
  }

  async reserveStorage(userId: string, bytes: number, quotaBytes: number) {
    const res = await this.users.findOneAndUpdate(
      {
        _id: userId,
        $expr: {
          $lte: [
            { $add: ['$storageUsedBytes', '$storageReservedBytes', bytes] },
            quotaBytes,
          ],
        },
      },
      {
        $inc: { storageReservedBytes: bytes },
        $set: { updatedAt: new Date().toISOString() },
      },
      { returnDocument: 'after' },
    );
    return Boolean(res);
  }

  async releaseReservation(userId: string, bytes: number) {
    await this.users.updateOne(
      { _id: userId },
      [
        {
          $set: {
            storageReservedBytes: {
              $max: [0, { $subtract: ['$storageReservedBytes', bytes] }],
            },
            updatedAt: new Date().toISOString(),
          },
        },
      ],
    );
  }

  async commitReservation(userId: string, reservedBytes: number, actualBytes: number) {
    await this.users.updateOne(
      { _id: userId },
      [
        {
          $set: {
            storageReservedBytes: {
              $max: [0, { $subtract: ['$storageReservedBytes', reservedBytes] }],
            },
            storageUsedBytes: { $add: ['$storageUsedBytes', actualBytes] },
            updatedAt: new Date().toISOString(),
          },
        },
      ],
    );
  }

  async hitRateLimit(key: string, limit: number, windowMs: number) {
    const now = new Date();
    const existing = await this.rateLimits.findOne({ _id: key });
    if (!existing || new Date(existing.resetAt) <= now) {
      const resetAt = new Date(now.getTime() + windowMs).toISOString();
      await this.rateLimits.updateOne(
        { _id: key },
        { $set: { _id: key, count: 1, resetAt } },
        { upsert: true },
      );
      return { allowed: true, remaining: limit - 1 };
    }
    const res = await this.rateLimits.findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 } },
      { returnDocument: 'after' },
    );
    const count = res?.count ?? limit + 1;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async close() {
    await this.client.close();
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
