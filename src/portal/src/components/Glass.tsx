import React from "react";
import LiquidGlass from "liquid-glass-react";

interface GlassProps {
  children: React.ReactNode;
  className?: string;
  cornerRadius?: number;
  displacementScale?: number;
  blurAmount?: number;
  elasticity?: number;
  padding?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

const Glass: React.FC<GlassProps> = ({
  children,
  className = "",
  cornerRadius = 14,
  displacementScale = 30,
  blurAmount = 0.08,
  elasticity = 0.5,
  padding,
  style,
  onClick,
}) => {
  return (
    <LiquidGlass
      className={className}
      cornerRadius={cornerRadius}
      displacementScale={displacementScale}
      blurAmount={blurAmount}
      elasticity={elasticity}
      padding={padding}
      style={style}
      onClick={onClick}
    >
      {children}
    </LiquidGlass>
  );
};

export default Glass;
