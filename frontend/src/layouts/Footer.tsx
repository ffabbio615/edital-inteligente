import Container from '../components/ui/Container'
import styles from './Footer.module.scss'

const institutionalLinks = [
  { href: '#sobre', label: 'Sobre a plataforma' },
  { href: '#termos', label: 'Termos de uso' },
  { href: '#privacidade', label: 'Política de privacidade' },
  { href: '#contato', label: 'Contato' },
]

function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className={styles.footer}>
      <Container className={styles.inner}>
        <section id="sobre" className={styles.about} aria-labelledby="footer-sobre-titulo">
          <h2 id="footer-sobre-titulo" className={styles.brand}>
            Edital Inteligente
          </h2>
          <p className={styles.text}>
            Plataforma que reúne e organiza editais, financiamentos, bolsas, programas de
            aceleração e premiações, para que você encontre as oportunidades certas com
            menos esforço.
          </p>
        </section>

        <nav aria-label="Links institucionais">
          <ul className={styles.links}>
            {institutionalLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={styles.link}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Container>

      <Container>
        <p className={styles.copyright}>
          © {currentYear} Edital Inteligente. Todos os direitos reservados.
        </p>
      </Container>
    </footer>
  )
}

export default Footer
