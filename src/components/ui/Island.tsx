import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

type IslandProps = HTMLAttributes<HTMLDivElement> & { padding?: number; children?: ReactNode }

export function Island({ padding = 0, className = '', style, children, ...rest }: IslandProps) {
  return <div className={`Island ${className}`.trim()} style={{ '--padding': padding, ...style } as CSSProperties} {...rest}>{children}</div>
}

type StackProps = HTMLAttributes<HTMLDivElement> & { direction?: 'horizontal' | 'vertical'; gap?: number }

export function Stack({ direction = 'vertical', gap = 0, className = '', style, children, ...rest }: StackProps) {
  return <div className={`Stack Stack_${direction} ${className}`.trim()} style={{ '--gap': gap, ...style } as CSSProperties} {...rest}>{children}</div>
}
