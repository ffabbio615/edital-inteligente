import type { ReactNode } from 'react'
import styles from './Badge.module.scss'

type BadgeTone = 'neutral' | 'primary' | 'warning'

interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
}

function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>
}

export default Badge
