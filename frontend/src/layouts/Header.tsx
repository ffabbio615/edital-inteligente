import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Button from '../components/ui/Button'
import Container from '../components/ui/Container'
import styles from './Header.module.scss'

const navigationLinks = [
  { section: 'inicio', label: 'Início' },
  { section: 'oportunidades', label: 'Oportunidades' },
  { section: 'sobre', label: 'Sobre' },
]

interface SectionLinkProps {
  section: string
  className: string
  children: ReactNode
}

/**
 * Link para uma seção da Home. Na própria Home é uma âncora comum (preserva filtros e página
 * da URL); em outras páginas navega para a Home e a Home rola até a seção.
 */
function SectionLink({ section, className, children }: SectionLinkProps) {
  const { pathname } = useLocation()

  if (pathname === '/') {
    return (
      <a href={`#${section}`} className={className}>
        {children}
      </a>
    )
  }

  return (
    <Link to={{ pathname: '/', hash: section }} className={className}>
      {children}
    </Link>
  )
}

function Header() {
  return (
    <header className={styles.header}>
      <Container className={styles.inner}>
        <SectionLink section="inicio" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true">
            EI
          </span>
          Edital Inteligente
        </SectionLink>

        <nav className={styles.nav} aria-label="Navegação principal">
          <ul className={styles.navList}>
            {navigationLinks.map((link) => (
              <li key={link.section}>
                <SectionLink section={link.section} className={styles.navLink}>
                  {link.label}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Autenticação ainda não implementada: o botão é apenas visual nesta etapa. */}
        <Button variant="secondary" className={styles.account}>
          Acessar conta
        </Button>
      </Container>
    </header>
  )
}

export default Header
