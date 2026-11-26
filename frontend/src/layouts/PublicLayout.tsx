import type { ReactNode } from 'react'
import Footer from './Footer'
import Header from './Header'
import styles from './PublicLayout.module.scss'

interface PublicLayoutProps {
  children: ReactNode
}

function PublicLayout({ children }: PublicLayoutProps) {
  return (
    <div className={styles.layout}>
      <a href="#conteudo" className={styles.skipLink}>
        Pular para o conteúdo
      </a>
      <Header />
      <main id="conteudo" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  )
}

export default PublicLayout
