import type { ReactNode } from 'react'
import styles from './SectionHeading.module.scss'

interface SectionHeadingProps {
  /** Id do título, para ser usado em `aria-labelledby` da seção. */
  id: string
  title: string
  description?: string
  /** Conteúdo extra ao lado do título (ex.: um selo). */
  aside?: ReactNode
}

function SectionHeading({ id, title, description, aside }: SectionHeadingProps) {
  return (
    <div className={styles.heading}>
      <div className={styles.titleRow}>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {aside}
      </div>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  )
}

export default SectionHeading
