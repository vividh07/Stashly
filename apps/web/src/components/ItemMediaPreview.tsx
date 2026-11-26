import { useQuery } from '@tanstack/react-query';
import { FileText, Film, Music2 } from 'lucide-react';
import type { ItemDto } from '@vault/shared';
import clsx from 'clsx';
import { api } from '../lib/api';
import { safeHttpUrl } from '../lib/safeUrl';

function isImageItem(item: ItemDto): boolean {
  return item.contentType === 'image' || Boolean(item.mimeType?.startsWith('image/'));
}

function isVideoItem(item: ItemDto): boolean {
  return item.contentType === 'video' || Boolean(item.mimeType?.startsWith('video/'));
}

function isAudioItem(item: ItemDto): boolean {
  return item.contentType === 'audio' || Boolean(item.mimeType?.startsWith('audio/'));
}

function resolvePreviewSrc(url: string): string {
  if (url.startsWith('/')) return url;
  try {
    const parsed = new URL(url, location.origin);
    if (parsed.origin === location.origin) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* keep absolute */
  }
  return url;
}

export function itemWantsMediaPreview(item: ItemDto): boolean {
  const linkPreview = safeHttpUrl(item.metadata?.previewImage as string | undefined);
  if (linkPreview) return true;
  if (!item.objectKey) return false;
  return isImageItem(item) || isVideoItem(item) || isAudioItem(item);
}

interface Props {
  item: ItemDto;
  className?: string;
  /** Taller preview for detail drawer */
  large?: boolean;
}

export function ItemMediaPreview({ item, className, large }: Props) {
  const linkPreview = safeHttpUrl(item.metadata?.previewImage as string | undefined);
  const needsSigned =
    !linkPreview &&
    Boolean(item.objectKey) &&
    (isImageItem(item) || isVideoItem(item) || isAudioItem(item));

  const previewQuery = useQuery({
    queryKey: ['preview-url', item.id],
    enabled: needsSigned,
    staleTime: 8 * 60 * 1000,
    queryFn: async () => {
      const { url, expiresAt } = await api.previewUrl(item.id);
      return { url: resolvePreviewSrc(url), expiresAt };
    },
  });

  const src = linkPreview || previewQuery.data?.url || null;
  const height = large ? 'h-52' : 'h-28';

  if (!itemWantsMediaPreview(item) && !needsSigned) return null;

  if (isAudioItem(item) && item.objectKey) {
    return (
      <div
        className={clsx(
          'mb-3 overflow-hidden rounded-xl border border-line/40 bg-mist/30 p-3',
          className,
        )}
      >
        {src ? (
          <audio controls preload="metadata" src={src} className="w-full" />
        ) : (
          <div className="flex items-center gap-2 text-xs text-mute">
            <Music2 size={16} className="text-accent" />
            {previewQuery.isLoading ? 'Loading preview…' : item.fileName || 'Audio'}
          </div>
        )}
      </div>
    );
  }

  if (isVideoItem(item) && (src || needsSigned)) {
    return (
      <div
        className={clsx(
          'mb-3 overflow-hidden rounded-xl border border-line/40 bg-black/40',
          height,
          className,
        )}
      >
        {src ? (
          <video
            src={src}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
            controls={large}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-mute">
            <Film size={28} className="opacity-50" />
          </div>
        )}
      </div>
    );
  }

  if ((isImageItem(item) && (src || needsSigned)) || linkPreview) {
    return (
      <div
        className={clsx(
          'mb-3 overflow-hidden rounded-xl border border-line/40 bg-mist/20',
          height,
          className,
        )}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-mute">
            <FileText size={24} className="opacity-40" />
          </div>
        )}
      </div>
    );
  }

  return null;
}
