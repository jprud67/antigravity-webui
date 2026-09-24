import React from 'react';
import {
  FileText,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileArchive,
  Image as ImageIcon,
  Terminal,
  Database,
  Sliders,
  GitBranch,
  FileAudio,
  FileVideo,
  Folder,
  FolderOpen,
  File,
  Lock,
} from 'lucide-react';

export interface FileIconProps {
  filename: string;
  isDir?: boolean;
  isExpanded?: boolean;
  className?: string;
}

export const FileIcon: React.FC<FileIconProps> = React.memo(({
  filename,
  isDir = false,
  isExpanded = false,
  className = 'w-3.5 h-3.5',
}) => {
  if (isDir) {
    return isExpanded ? (
      <FolderOpen className={`${className} text-amber-400 shrink-0`} />
    ) : (
      <Folder className={`${className} text-amber-500/90 shrink-0`} />
    );
  }

  const lowerName = filename.toLowerCase();

  // Special full filenames
  if (lowerName === '.gitignore' || lowerName === '.gitattributes' || lowerName === '.gitmodules') {
    return <GitBranch className={`${className} text-orange-500 shrink-0`} />;
  }
  if (lowerName === 'package.json' || lowerName === 'composer.json' || lowerName === 'cargo.toml') {
    return <FileJson className={`${className} text-emerald-400 shrink-0`} />;
  }
  if (lowerName.includes('lock')) {
    return <Lock className={`${className} text-amber-400 shrink-0`} />;
  }
  if (lowerName.startsWith('.env')) {
    return <Sliders className={`${className} text-pink-400 shrink-0`} />;
  }
  if (lowerName === 'dockerfile' || lowerName.startsWith('dockerfile.')) {
    return <Terminal className={`${className} text-sky-400 shrink-0`} />;
  }

  const ext = lowerName.split('.').pop() || '';

  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode className={`${className} text-sky-400 shrink-0`} />;
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return <FileCode className={`${className} text-yellow-400 shrink-0`} />;
    case 'py':
    case 'pyw':
      return <FileCode className={`${className} text-emerald-400 shrink-0`} />;
    case 'html':
    case 'htm':
      return <FileCode className={`${className} text-orange-500 shrink-0`} />;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return <FileCode className={`${className} text-fuchsia-400 shrink-0`} />;
    case 'json':
      return <FileJson className={`${className} text-amber-400 shrink-0`} />;
    case 'md':
    case 'markdown':
      return <FileText className={`${className} text-cyan-400 shrink-0`} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
    case 'bmp':
      return <ImageIcon className={`${className} text-purple-400 shrink-0`} />;
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
    case 'rar':
      return <FileArchive className={`${className} text-rose-400 shrink-0`} />;
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
    case 'bat':
    case 'cmd':
      return <Terminal className={`${className} text-emerald-400 shrink-0`} />;
    case 'sql':
    case 'db':
    case 'sqlite':
      return <Database className={`${className} text-indigo-400 shrink-0`} />;
    case 'csv':
    case 'xlsx':
    case 'xls':
      return <FileSpreadsheet className={`${className} text-emerald-500 shrink-0`} />;
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'conf':
      return <Sliders className={`${className} text-pink-400 shrink-0`} />;
    case 'mp3':
    case 'wav':
    case 'ogg':
      return <FileAudio className={`${className} text-violet-400 shrink-0`} />;
    case 'mp4':
    case 'webm':
    case 'mkv':
    case 'avi':
      return <FileVideo className={`${className} text-rose-500 shrink-0`} />;
    default:
      return <File className={`${className} text-slate-400 shrink-0`} />;
  }
});

FileIcon.displayName = 'FileIcon';
