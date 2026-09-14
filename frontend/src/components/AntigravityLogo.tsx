import React from 'react';
import iconSvgUrl from '../assets/antigravity-icon.svg';
import fullLogoUrl from '../assets/antigravity-logo.svg';

interface LogoProps {
  className?: string;
  size?: number | string;
  style?: React.CSSProperties;
}

/**
 * Official Google Antigravity Icon Mark (Vibrant Gradient Loop)
 */
export const AntigravityIcon: React.FC<LogoProps> = ({ className = '', size = 24, style = {} }) => {
  return (
    <img
      src={iconSvgUrl}
      alt="Antigravity Icon"
      width={size}
      height={size}
      className={`shrink-0 select-none ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        ...style,
      }}
      draggable={false}
    />
  );
};

/**
 * Official Google Antigravity Full Logo (Icon + Wordmark)
 */
export const AntigravityLogo: React.FC<LogoProps & { height?: number | string }> = ({
  className = '',
  height = 24,
  style = {},
}) => {
  return (
    <img
      src={fullLogoUrl}
      alt="Google Antigravity"
      height={height}
      className={`shrink-0 select-none ${className}`}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        width: 'auto',
        ...style,
      }}
      draggable={false}
    />
  );
};
