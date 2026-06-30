import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/60 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-semibold',
    secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700',
    ghost: 'text-slate-400 hover:text-white hover:bg-slate-800',
    danger: 'bg-rose-600/90 text-white hover:bg-rose-500',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export default Button
