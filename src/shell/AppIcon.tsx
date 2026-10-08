import React from 'react'
import {
  Activity, AppWindow, Archive, ArrowLeftRight, Award, Battery, BatteryCharging, Bell, Book,
  BookOpen, Box, Bug, Calculator, Calendar, Camera, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Circle, Clock, Cloud, CloudRain, CloudSun, Code, Compass, Copy, Cpu, CreditCard,
  Download, File, FileCode, FileText, Folder, FolderOpen, Gamepad2, Globe, Grid3x3, HardDrive,
  Heart, HelpCircle, Home, Image, Info, Layers, LayoutGrid, Lightbulb, Link, List, Lock, LogOut,
  Mail, Map, MapPin, Maximize2, MemoryStick, MessageSquare, Mic, Minus, Monitor, Moon, MoreVertical,
  MousePointer, Music, Network, Newspaper, Package, Paintbrush, Palette, Pause, Play, Plus, Power,
  Printer,
  RefreshCw, RotateCcw, Save, Search, Settings, Share, Shield, ShieldCheck, ShoppingBag, SkipBack,
  SkipForward, Sparkles, Star, Sun, Terminal, Trash2, Triangle, Upload, User, Users, Video,
  Square, MonitorPlay, Type, Volume1, Volume2, VolumeX, Wifi, WifiOff, Wind, Wrench, X, Zap,
  type LucideIcon,
} from 'lucide-react'

export const GLYPHS: Record<string, LucideIcon> = {
  Activity, AppWindow, Archive, ArrowLeftRight, Award, Battery, BatteryCharging, Bell, Book, BookOpen,
  Box, Bug, Calculator, Calendar, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Circle, Clock, Cloud, CloudRain, CloudSun, Code, Compass, Copy, Cpu, CreditCard, Download, File,
  FileCode, FileText, Folder, FolderOpen, Gamepad2, Globe, Grid3x3, HardDrive, Heart, HelpCircle,
  Home, Image, Info, Layers, LayoutGrid, Lightbulb, Link, List, Lock, LogOut, Mail, Map, MapPin,
  Maximize2, MemoryStick, MessageSquare, Mic, Minus, Monitor, Moon, MoreVertical, MousePointer,
  Music, Network, Newspaper, Package, Paintbrush, Palette, Pause, Play, Plus, Power, Printer,
  RefreshCw,
  RotateCcw, Save, Search, Settings, Share, Shield, ShieldCheck, ShoppingBag, SkipBack, SkipForward,
  Sparkles, Square, MonitorPlay, Type, Star, Sun, Terminal, Trash2, Triangle, Upload, User, Users,
  Video, Volume1, Volume2, VolumeX, Wifi, WifiOff, Wind, Wrench, X, Zap,
}

export function Glyph({ name, className, size = 16 }: { name: string; className?: string; size?: number }) {
  const Cmp = GLYPHS[name] ?? Box
  return <Cmp size={size} className={className} strokeWidth={1.9} />
}

/** Mint-style application icon: rounded gradient tile with a white glyph. */
export function AppIcon({
  glyph,
  color,
  color2,
  size = 32,
  className = '',
  rounded = 0.26,
}: {
  glyph: string
  color: string
  color2?: string
  size?: number
  className?: string
  rounded?: number
}) {
  const c2 = color2 ?? color
  const id = React.useMemo(() => `g${Math.random().toString(36).slice(2, 8)}`, [])
  const r = size * (rounded as number)
  const inner = size * 0.58
  return (
    <svg width={size} height={size} className={className} style={{ flex: 'none' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor={lighten(c2, 0.22)} />
          <stop offset="1" stopColor={darken(color, 0.14)} />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width={size - 1} height={size - 1} rx={r} fill={`url(#${id})`} />
      <rect
        x="0.5"
        y="0.5"
        width={size - 1}
        height={size - 1}
        rx={r}
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="1"
      />
      <rect
        x={size * 0.06}
        y={size * 0.06}
        width={size * 0.88}
        height={size * 0.44}
        rx={r * 0.8}
        fill="rgba(255,255,255,0.16)"
      />
      <foreignObject x={size * 0.21} y={size * 0.21} width={inner} height={inner}>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
          }}
        >
          <Glyph name={glyph} size={inner * 0.82} />
        </div>
      </foreignObject>
    </svg>
  )
}

export function lighten(hex: string, amt: number) {
  return mix(hex, '#ffffff', amt)
}
export function darken(hex: string, amt: number) {
  return mix(hex, '#000000', amt)
}
function mix(a: string, b: string, t: number) {
  const pa = parse(a)
  const pb = parse(b)
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `rgb(${out[0]}, ${out[1]}, ${out[2]})`
}
function parse(hex: string) {
  const c = hex.replace('#', '')
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c
  const n = parseInt(f, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** File-type icon for the file manager (Mint-Y-ish colours). */
export function FileIcon({ node, size = 24 }: { node: { type: string; mime?: string; name?: string }; size?: number }) {
  if (node.type === 'dir') return <AppIcon glyph="Folder" color="#e8b64c" color2="#c98f18" size={size} />
  const mime = node.mime || 'text/plain'
  const name = node.name || ''
  if (mime.startsWith('image/')) return <AppIcon glyph="Image" color="#4a9be8" color2="#2b6cb0" size={size} />
  if (mime.startsWith('audio/')) return <AppIcon glyph="Music" color="#b06ee8" color2="#7c3aed" size={size} />
  if (mime.startsWith('video/')) return <AppIcon glyph="Video" color="#e8664a" color2="#b91c1c" size={size} />
  if (mime.startsWith('application/zip') || name.endsWith('.zip'))
    return <AppIcon glyph="Archive" color="#d8a13a" color2="#92650d" size={size} />
  if (name.endsWith('.md')) return <AppIcon glyph="FileCode" color="#4aa8a0" color2="#0f766e" size={size} />
  return <AppIcon glyph="FileText" color="#8d9aa6" color2="#5b6670" size={size} />
}
