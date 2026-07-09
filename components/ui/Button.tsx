import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-sm hover:shadow-cyan-glow",
  secondary:
    "bg-surface text-primary-blue border border-primary-blue/30 hover:border-primary-blue hover:bg-accent-blue-soft",
  danger: "bg-brand-orange text-white shadow-sm hover:brightness-95",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

export function Button({ variant = "primary", icon, className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none ${VARIANT_CLASS[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
