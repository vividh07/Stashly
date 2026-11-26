import type { LucideIcon } from 'lucide-react';
import {
  AlarmClock,
  Archive,
  Bookmark,
  Copy,
  FileText,
  Film,
  FolderKanban,
  Heart,
  Image as ImageIcon,
  LayoutDashboard,
  Music2,
  Settings,
  StickyNote,
  Trash2,
  Boxes,
} from 'lucide-react';
import type { ContentType } from '@vault/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  contentType?: ContentType;
  filter?: 'favorites' | 'archive' | 'trash' | 'all';
}

export const mainNav: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/items', label: 'All Items', icon: Boxes, filter: 'all' },
  { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark, contentType: 'bookmark' },
  { to: '/images', label: 'Images', icon: ImageIcon, contentType: 'image' },
  { to: '/videos', label: 'Videos', icon: Film, contentType: 'video' },
  { to: '/files', label: 'Files', icon: FileText, contentType: 'file' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, contentType: 'project' },
  { to: '/audio', label: 'Audio', icon: Music2, contentType: 'audio' },
  { to: '/notes', label: 'Notes', icon: StickyNote, contentType: 'note' },
  { to: '/favorites', label: 'Favorites', icon: Heart, filter: 'favorites' },
  { to: '/archive', label: 'Archive', icon: Archive, filter: 'archive' },
  { to: '/trash', label: 'Trash', icon: Trash2, filter: 'trash' },
  { to: '/reminders', label: 'Reminders', icon: AlarmClock },
  { to: '/duplicates', label: 'Duplicates', icon: Copy },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
