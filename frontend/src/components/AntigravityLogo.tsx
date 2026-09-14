import React from 'react';

interface LogoProps {
  className?: string;
  size?: number | string;
  style?: React.CSSProperties;
}

/**
 * Official Google Antigravity Icon Mark (Vibrant Gradient Infinity Loop)
 * Ultra-sharp, high-contrast vector rendering that shines on dark (#0A0E17) and light (#FFFFFF) backgrounds.
 */
export const AntigravityIcon: React.FC<LogoProps> = ({ className = '', size = 24, style = {} }) => {
  const pixelSize = typeof size === 'number' ? `${size}px` : size;

  return (
    <svg
      viewBox="8 16 95 83"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      style={{
        width: pixelSize,
        height: pixelSize,
        display: 'inline-block',
        verticalAlign: 'middle',
        ...style,
      }}
      aria-label="Google Antigravity"
    >
      <defs>
        {/* Clip the exact Google Antigravity infinity loop silhouette */}
        <clipPath id="agyLoopContour">
          <path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" />
        </clipPath>

        {/* Vivid Multi-Stop Base Gradient */}
        <linearGradient id="agyLoopGlow" x1="15%" y1="90%" x2="85%" y2="20%">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="25%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#FACC15" />
          <stop offset="75%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>

        <linearGradient id="agyBlueSegment" x1="50%" y1="40%" x2="90%" y2="100%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="60%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>

        <linearGradient id="agyRedSegment" x1="40%" y1="20%" x2="100%" y2="40%">
          <stop offset="0%" stopColor="#FACC15" />
          <stop offset="40%" stopColor="#FB923C" />
          <stop offset="85%" stopColor="#EF4444" />
          <stop offset="100%" stopColor="#DC2626" />
        </linearGradient>

        <linearGradient id="agyGreenSegment" x1="60%" y1="20%" x2="0%" y2="90%">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="30%" stopColor="#4ADE80" />
          <stop offset="70%" stopColor="#16A34A" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>

        <filter id="agyAmbientGlow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#38BDF8" floodOpacity="0.3" />
        </filter>
      </defs>

      {/* Base vibrant silhouette with soft ambient glow */}
      <path
        d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z"
        fill="url(#agyLoopGlow)"
        filter="url(#agyAmbientGlow)"
      />

      {/* Clipped luminous gradient intersections */}
      <g clipPath="url(#agyLoopContour)">
        {/* Top-Right Red / Orange Burst */}
        <circle cx="85" cy="38" r="32" fill="url(#agyRedSegment)" />
        {/* Left Green / Cyan Burst */}
        <circle cx="24" cy="55" r="36" fill="url(#agyGreenSegment)" />
        {/* Top Yellow Apex Burst */}
        <circle cx="56" cy="22" r="18" fill="#FACC15" />
        {/* Bottom Right Blue/Cyan Base Burst */}
        <circle cx="78" cy="85" r="30" fill="url(#agyBlueSegment)" />
        {/* Crossing Waist Glow */}
        <ellipse cx="55.8" cy="59.8" rx="16" ry="12" fill="#38BDF8" opacity="0.6" />
      </g>
    </svg>
  );
};

/**
 * Official Google Antigravity Full Logo (Single Icon + Wordmark)
 */
export const AntigravityLogo: React.FC<LogoProps & { height?: number | string; showIcon?: boolean }> = ({
  className = '',
  height = 24,
  showIcon = true,
  style = {},
}) => {
  const pixelHeight = typeof height === 'number' ? `${height}px` : height;
  const iconSize = typeof height === 'number' ? height * 1.1 : height;

  return (
    <div
      className={`inline-flex items-center gap-2 select-none ${className}`}
      style={{ height: pixelHeight, ...style }}
    >
      {showIcon && <AntigravityIcon size={iconSize} />}
      <span
        className="font-bold tracking-tight font-sans text-sm sm:text-base leading-none truncate"
        style={{ color: 'var(--strong)' }}
      >
        Antigravity
      </span>
    </div>
  );
};
