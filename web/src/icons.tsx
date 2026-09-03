// Phosphor icon set — one family, consistent regular weight, currentColor.
// Star vs StarOutline are distinct: fill vs regular weight.
import type { SVGProps } from 'react';
import {
  Archive,
  ArrowBendUpLeft,
  ArrowLeft,
  ArrowsClockwise,
  CaretDown,
  CheckCircle,
  Circle,
  Clock,
  Envelope,
  EnvelopeOpen,
  Info,
  Lightning,
  MagnifyingGlass,
  Paperclip,
  Sparkle,
  Star,
  Trash,
  Tray,
  Warning,
  X,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  weight?: IconWeight;
}

function IconShell({
  size = 20,
  weight = 'regular' as IconWeight,
  phosphor: Ph,
  ...rest
}: IconProps & { phosphor: PhosphorIcon; weight?: IconWeight }) {
  return <Ph size={size} weight={weight} aria-hidden="true" focusable="false" {...(rest as unknown as Record<string, unknown>)} />;
}

export function SearchIcon(props: IconProps) {
  return <IconShell phosphor={MagnifyingGlass} {...props} />;
}

export function MailIcon(props: IconProps) {
  return <IconShell phosphor={Envelope} {...props} />;
}

export function MailOpenIcon(props: IconProps) {
  return <IconShell phosphor={EnvelopeOpen} {...props} />;
}

export function InboxIcon(props: IconProps) {
  return <IconShell phosphor={Tray} {...props} />;
}

export function StarIcon(props: IconProps) {
  return <IconShell phosphor={Star} weight="fill" {...props} />;
}

export function StarOutlineIcon(props: IconProps) {
  return <IconShell phosphor={Star} weight="regular" {...props} />;
}

export function ArchiveIcon(props: IconProps) {
  return <IconShell phosphor={Archive} {...props} />;
}

export function BoltIcon(props: IconProps) {
  return <IconShell phosphor={Lightning} {...props} />;
}

export function CircleIcon(props: IconProps) {
  return <IconShell phosphor={Circle} {...props} />;
}

export function ReplyIcon(props: IconProps) {
  return <IconShell phosphor={ArrowBendUpLeft} {...props} />;
}

export function SparklesIcon(props: IconProps) {
  return <IconShell phosphor={Sparkle} {...props} />;
}

export function RefreshIcon(props: IconProps) {
  return <IconShell phosphor={ArrowsClockwise} {...props} />;
}

export function XIcon(props: IconProps) {
  return <IconShell phosphor={X} {...props} />;
}

export function BackIcon(props: IconProps) {
  return <IconShell phosphor={ArrowLeft} {...props} />;
}

export function CheckCircleIcon(props: IconProps) {
  return <IconShell phosphor={CheckCircle} {...props} />;
}

export function AlertTriangleIcon(props: IconProps) {
  return <IconShell phosphor={Warning} {...props} />;
}

export function InfoIcon(props: IconProps) {
  return <IconShell phosphor={Info} {...props} />;
}

export function TrashIcon(props: IconProps) {
  return <IconShell phosphor={Trash} {...props} />;
}

export function PaperclipIcon(props: IconProps) {
  return <IconShell phosphor={Paperclip} {...props} />;
}

export function ChevronIcon(props: IconProps) {
  return <IconShell phosphor={CaretDown} {...props} />;
}

export function ClockIcon(props: IconProps) {
  return <IconShell phosphor={Clock} {...props} />;
}
