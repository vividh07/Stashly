import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  Camera,
  Clipboard,
  FileText,
  Film,
  FolderKanban,
  Image as ImageIcon,
  Music2,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  CONTENT_TYPES,
  cleanUrl,
  inferContentTypeFromMime,
  inferContentTypeFromUrl,
  type ContentType,
  type ItemDto,
} from '@vault/shared';
import { api, uploadToPresigned } from '../lib/api';
import { queuePendingNoteCapture, queuePendingUpload, queuePendingUrlCapture } from '../lib/sync';
import { sha256File } from '../lib/clientCrypto';
import { useUiStore } from '../stores/ui';

const TYPE_META: Record<
  ContentType,
  { label: string; icon: typeof Bookmark; hint: string; accept?: string }
> = {
  bookmark: {
    label: 'Bookmark',
    icon: Bookmark,
    hint: 'Paste a website link',
  },
  image: {
    label: 'Image',
    icon: ImageIcon,
    hint: 'Upload a photo or image',
    accept: 'image/*',
  },
  video: {
    label: 'Video',
    icon: Film,
    hint: 'Upload a video or paste a video URL',
    accept: 'video/*',
  },
  file: {
    label: 'File',
    icon: FileText,
    hint: 'Upload a document or archive',
    accept: '.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,application/zip',
  },
  project: {
    label: 'Project',
    icon: FolderKanban,
    hint: 'GitHub link or project ZIP',
    accept: '.zip,application/zip',
  },
  audio: {
    label: 'Audio',
    icon: Music2,
    hint: 'Upload audio or paste an audio URL',
    accept: 'audio/*',
  },
  note: {
    label: 'Note',
    icon: StickyNote,
    hint: 'Quick text or markdown note',
  },
};

const URL_TYPES = new Set<ContentType>(['bookmark', 'video', 'audio', 'project']);
const FILE_TYPES = new Set<ContentType>(['image', 'video', 'file', 'project', 'audio']);

interface ExtraPage {
  id: string;
  file: File;
}

export function CaptureModal() {
  const open = useUiStore((s) => s.captureOpen);
  const prefill = useUiStore((s) => s.capturePrefill);
  const close = useUiStore((s) => s.closeCapture);
  const setSyncStatus = useUiStore((s) => s.setSyncStatus);
  const openItemView = useUiStore((s) => s.openItemView);
  const qc = useQueryClient();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [contentType, setContentType] = useState<ContentType>('bookmark');
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<ExtraPage[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ItemDto | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const addPageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl(prefill?.url || '');
    setTitle(prefill?.title || '');
    setNotes(prefill?.notes || '');
    setTags('');
    setFile(null);
    setPages([]);
    setProgress(null);
    setError(null);
    setDuplicate(null);
    setContentType(prefill?.contentType || 'bookmark');
  }, [open, prefill]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUiStore.getState().openCapture();
      }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const typeMeta = TYPE_META[contentType];
  const showUrl = URL_TYPES.has(contentType);
  const showFile = FILE_TYPES.has(contentType);
  const showCamera = contentType === 'image';

  const pickType = (type: ContentType) => {
    setContentType(type);
    setError(null);
    setDuplicate(null);
    if (!FILE_TYPES.has(type)) {
      setFile(null);
      setPages([]);
    }
    if (!URL_TYPES.has(type)) setUrl('');
  };

  const onPasteFromClipboard = async () => {
    setError(null);
    setDuplicate(null);
    try {
      if (navigator.clipboard?.read) {
        try {
          const clipItems = await navigator.clipboard.read();
          for (const clipItem of clipItems) {
            const imageType = clipItem.types.find((t) => t.startsWith('image/'));
            if (imageType) {
              const blob = await clipItem.getType(imageType);
              const ext = imageType.split('/')[1] || 'png';
              const pastedFile = new File([blob], `clipboard-image-${Date.now()}.${ext}`, {
                type: imageType,
              });
              setContentType('image');
              setFile(pastedFile);
              return;
            }
          }
        } catch {
          // Fall through to text — some browsers reject image clipboard reads without a user gesture nuance.
        }
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setError('Clipboard is empty');
        return;
      }
      if (/^https?:\/\//i.test(text)) {
        const cleaned = cleanUrl(text);
        setContentType(inferContentTypeFromUrl(cleaned));
        setUrl(cleaned);
      } else {
        setContentType('note');
        setNotes(text);
      }
    } catch {
      setError('Clipboard access was denied by the browser');
    }
  };

  const onAddPage = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const next = Array.from(fileList).map((f) => ({ id: crypto.randomUUID(), file: f }));
    setPages((prev) => [...prev, ...next]);
  };

  const removePage = (id: string) => setPages((prev) => prev.filter((p) => p.id !== id));

  const uploadOneFile = async (
    f: File,
    opts: { title: string; notes?: string; tags: string[]; contentType: ContentType },
    onProgress?: (pct: number) => void,
  ): Promise<{ item: ItemDto; duplicate: ItemDto | null }> => {
    const idempotencyKey = crypto.randomUUID();
    const mimeType = f.type || 'application/octet-stream';
    const contentHash = await sha256File(f).catch(() => undefined);

    if (!navigator.onLine) {
      await queuePendingUpload({
        id: idempotencyKey,
        fileName: f.name,
        mimeType,
        fileSize: f.size,
        title: opts.title,
        notes: opts.notes,
        tags: opts.tags,
        contentType: opts.contentType,
        contentHash,
        blob: await f.arrayBuffer(),
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
      setSyncStatus('offline', 'Saved locally — will sync when online');
      return { item: null as unknown as ItemDto, duplicate: null };
    }

    const { item, upload, duplicate: dup } = await api.requestUpload({
      fileName: f.name,
      mimeType,
      fileSize: f.size,
      title: opts.title,
      notes: opts.notes,
      tags: opts.tags,
      contentType: opts.contentType || inferContentTypeFromMime(mimeType),
      idempotencyKey,
      contentHash,
    });
    if (!upload.uploadUrl) throw new Error('Missing upload URL');
    const { etag } = await uploadToPresigned(upload.uploadUrl, f, onProgress);
    const done = await api.completeUpload(upload.id, etag, contentHash);
    return { item: done.item || item, duplicate: dup };
  };

  const save = useMutation({
    mutationFn: async (): Promise<{ item: ItemDto | null; duplicateItem: ItemDto | null }> => {
      setError(null);
      setDuplicate(null);
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (file) {
        setSyncStatus('syncing', 'Uploading…');
        setProgress(0);
        const primary = await uploadOneFile(
          file,
          { title: title || file.name, notes: notes || undefined, tags: tagList, contentType },
          setProgress,
        );

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          await uploadOneFile(page.file, {
            title: `${title || file.name} (page ${i + 2})`,
            tags: tagList,
            contentType: 'image',
          });
        }

        setSyncStatus('idle', navigator.onLine ? 'Uploaded' : undefined);
        return { item: primary.item, duplicateItem: primary.duplicate };
      }

      if (pages.length > 0 && contentType === 'image') {
        // Multi-page capture with no primary file selected — treat first page as primary.
        const [first, ...rest] = pages;
        setSyncStatus('syncing', 'Uploading…');
        setProgress(0);
        const primary = await uploadOneFile(
          first.file,
          { title: title || 'Scan', notes: notes || undefined, tags: tagList, contentType },
          setProgress,
        );
        for (let i = 0; i < rest.length; i++) {
          await uploadOneFile(rest[i].file, {
            title: `${title || 'Scan'} (page ${i + 2})`,
            tags: tagList,
            contentType: 'image',
          });
        }
        setSyncStatus('idle', navigator.onLine ? 'Uploaded' : undefined);
        return { item: primary.item, duplicateItem: primary.duplicate };
      }

      if (url.trim()) {
        const cleaned = cleanUrl(url.trim());
        if (cleaned !== url.trim()) setUrl(cleaned);
        if (!navigator.onLine) {
          const idempotencyKey = crypto.randomUUID();
          await queuePendingUrlCapture({
            id: idempotencyKey,
            url: cleaned,
            title: title || undefined,
            notes: notes || undefined,
            tags: tagList,
            contentType,
            createdAt: new Date().toISOString(),
            attempts: 0,
          });
          setSyncStatus('offline', 'Saved locally — will sync when online');
          return { item: null, duplicateItem: null };
        }
        const res = await api.captureUrl({
          url: cleaned,
          title: title || undefined,
          notes: notes || undefined,
          tags: tagList,
          contentType,
          idempotencyKey: crypto.randomUUID(),
        });
        return { item: res.item, duplicateItem: res.duplicate ? res.item : null };
      }

      if (contentType === 'note') {
        if (!title.trim() && !notes.trim()) throw new Error('Add a title or note');
        if (!navigator.onLine) {
          const idempotencyKey = crypto.randomUUID();
          await queuePendingNoteCapture({
            id: idempotencyKey,
            title: title.trim() || 'Quick note',
            body: notes.trim() || title.trim(),
            tags: tagList,
            createdAt: new Date().toISOString(),
            attempts: 0,
          });
          setSyncStatus('offline', 'Saved locally — will sync when online');
          return { item: null, duplicateItem: null };
        }
        const res = await api.captureNote({
          title: title.trim() || 'Quick note',
          body: notes.trim() || title.trim(),
          tags: tagList,
          idempotencyKey: crypto.randomUUID(),
        });
        return { item: res.item, duplicateItem: null };
      }

      if (contentType === 'bookmark') throw new Error('Paste a URL');
      if (contentType === 'image') throw new Error('Choose an image, use the camera, or paste one');
      if (contentType === 'video') throw new Error('Choose a video file or paste a video URL');
      if (contentType === 'audio') throw new Error('Choose an audio file or paste an audio URL');
      if (contentType === 'project') throw new Error('Paste a project URL or upload a ZIP');
      throw new Error('Choose a file to upload');
    },
    onSuccess: async (data) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['items'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['storage-usage'] }),
        qc.invalidateQueries({ queryKey: ['sync-queue'] }),
      ]);
      if (data.duplicateItem) {
        setDuplicate(data.duplicateItem);
      } else {
        close();
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4">
      <button className="absolute inset-0 cursor-default" aria-label="Close" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
        className="glass relative z-10 flex max-h-[100dvh] w-full max-w-xl flex-col rounded-t-3xl shadow-glass sm:max-h-[min(920px,92dvh)] sm:rounded-3xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line/80 sm:hidden" />

        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-3 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <h2 id="capture-title" className="text-lg font-semibold text-fog">
              Quick Capture
            </h2>
            <p className="mt-0.5 text-xs text-mute">{typeMeta.hint}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="btn-ghost touch-target px-2.5 text-xs"
              onClick={() => void onPasteFromClipboard()}
              title="Paste from clipboard"
            >
              <Clipboard size={16} />
              <span className="hidden sm:inline">Paste</span>
            </button>
            <button
              type="button"
              className="touch-target -mr-1 rounded-xl p-2.5 text-mute hover:bg-mist/50"
              onClick={close}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 sm:px-5">
          {duplicate && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-xs text-warn">
              <span>Similar item already in vault — “{duplicate.title}”.</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => {
                    openItemView(duplicate);
                    close();
                  }}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="text-warn/70 hover:text-warn"
                  onClick={() => setDuplicate(null)}
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="label">Save as</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CONTENT_TYPES.map((t) => {
                const meta = TYPE_META[t];
                const Icon = meta.icon;
                const active = contentType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-medium transition sm:justify-start sm:px-2.5 ${
                      active
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-line/50 bg-mist/20 text-mute active:bg-mist/40'
                    }`}
                    onClick={() => pickType(t)}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {showUrl && (
            <div className="mb-3">
              <label className="label">URL</label>
              <input
                className="input"
                inputMode="url"
                enterKeyHint="done"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={(e) => {
                  const trimmed = e.target.value.trim();
                  if (trimmed) setUrl(cleanUrl(trimmed));
                }}
                autoFocus={contentType === 'bookmark'}
              />
            </div>
          )}

          {showFile && (
            <div className="mb-3">
              <label className="label">
                {contentType === 'image'
                  ? 'Image'
                  : contentType === 'video'
                    ? 'Video'
                    : contentType === 'audio'
                      ? 'Audio'
                      : contentType === 'project'
                        ? 'ZIP (optional)'
                        : 'File'}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1 basis-[220px] file:mr-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-accent"
                  type="file"
                  accept={typeMeta.accept}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {showCamera && (
                  <>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const picked = e.target.files?.[0];
                        if (picked) setFile(picked);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className="btn-subtle shrink-0"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera size={14} /> Camera
                    </button>
                  </>
                )}
              </div>
              {file && (
                <p className="mt-1 break-all text-xs text-mute">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>
          )}

          {showCamera && (
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <label className="label mb-0">Multi-page scan</label>
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs text-accent"
                  onClick={() => addPageInputRef.current?.click()}
                >
                  <Plus size={14} /> Add page
                </button>
                <input
                  ref={addPageInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    onAddPage(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
              {pages.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {pages.map((p, i) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line/50 bg-mist/20 px-2.5 py-1.5 text-xs text-mute"
                    >
                      <span className="truncate">
                        Page {i + (file ? 2 : 1)} · {p.file.name}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-danger"
                        onClick={() => removePage(p.id)}
                        aria-label="Remove page"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mb-3">
            <label className="label">Title</label>
            <input
              className="input"
              placeholder={contentType === 'note' ? 'Note title' : 'Optional'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={contentType === 'note'}
            />
          </div>

          <div className="mb-3">
            <label className="label">{contentType === 'note' ? 'Note' : 'Notes'}</label>
            <textarea
              className="input min-h-[96px] resize-y"
              placeholder={contentType === 'note' ? 'Write your note…' : 'Optional notes or markdown'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="mb-2">
            <label className="label">Tags</label>
            <input
              className="input"
              placeholder="research, design, later"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          {progress != null && (
            <div className="mb-3 mt-3">
              <div className="mb-1 flex justify-between text-xs text-mute">
                <span>Uploading</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-void">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && <p className="mb-2 mt-3 text-sm text-danger">{error}</p>}
        </div>

        <div className="safe-pb flex shrink-0 flex-col gap-2 border-t border-line/50 bg-panel/80 px-4 py-3 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="hidden text-xs text-mute sm:block">⌘/Ctrl + K anywhere</p>
          <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
            <button type="button" className="btn-ghost min-h-11" onClick={close}>
              {duplicate ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              className="btn-primary min-h-11"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : `Save ${typeMeta.label.toLowerCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
