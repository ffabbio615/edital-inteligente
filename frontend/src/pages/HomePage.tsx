import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Container from '../components/ui/Container'
import SectionHeading from '../components/ui/SectionHeading'
import CategoryCard from '../features/opportunities/components/CategoryCard'
import OpportunityList from '../features/opportunities/components/OpportunityList'
import OpportunitySearchForm from '../features/opportunities/components/OpportunitySearchForm'
import { publicCategories } from '../features/opportunities/categories'
import {
  type OpportunityFilters,
  filtersFromSearchParams,
  filtersKey,
  hasActiveFilters,
  listSearchParams,
  pageFromSearchParams,
} from '../features/opportunities/filters'
import styles from './HomePage.module.scss'

const OPPORTUNITIES_SECTION_ID = 'oportunidades'

/** Estado da entrada da Home no histórico: marcado ao abrir um detalhe pela listagem. */
interface HomeLocationState {
  scrollToList?: boolean
}

/** Leva a lista de oportunidades à vista, respeitando a preferência por menos movimento. */
function scrollToOpportunities(animate = true) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document
    .getElementById(OPPORTUNITIES_SECTION_ID)
    ?.scrollIntoView({ behavior: animate && !reduceMotion ? 'smooth' : 'auto', block: 'start' })
}

function HomePage() {
  // Filtros aplicados e página ficam na URL (ex.: /?status=open&page=2): voltar da página de
  // detalhes, ou usar o botão Voltar do navegador, restaura exatamente a mesma listagem.
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const page = pageFromSearchParams(searchParams)
  const currentFiltersKey = filtersKey(filters)
  const isSearching = hasActiveFilters(filters)

  // Na montagem: ao voltar de um detalhe aberto pela listagem, leva a lista à vista; ao chegar
  // por um link de seção vindo de outra página (/#sobre), rola até a seção.
  const scrollOnMount = useRef({
    toList: (location.state as HomeLocationState | null)?.scrollToList === true,
    hash: location.hash.slice(1),
  })
  useEffect(() => {
    document.title = 'Edital Inteligente'
    const { toList, hash } = scrollOnMount.current
    if (toList) {
      scrollToOpportunities(false)
    } else if (hash) {
      document.getElementById(hash)?.scrollIntoView({ block: 'start' })
    }
  }, [])

  // Nova busca: filtros na URL e paginação reiniciada (a página 1 não aparece na URL).
  function handleSearch(nextFilters: OpportunityFilters) {
    setSearchParams(listSearchParams(nextFilters))
    scrollToOpportunities()
  }

  function handleClear() {
    setSearchParams(listSearchParams({}))
  }

  const handlePageChange = useCallback(
    (nextPage: number, options?: { replace?: boolean }) => {
      setSearchParams(listSearchParams(filters, nextPage), { replace: options?.replace })
    },
    [filters, setSearchParams],
  )

  // Antes de abrir um detalhe, marca a entrada atual do histórico para rolar até a lista na volta.
  const handleOpenOpportunity = useCallback(() => {
    const state: HomeLocationState = { scrollToList: true }
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state })
  }, [navigate, location.pathname, location.search])

  return (
    <>
      <section id="inicio" className={styles.hero} aria-labelledby="hero-titulo">
        <Container className={styles.heroInner}>
          <p className={styles.eyebrow}>Oportunidades públicas e privadas em um só lugar</p>
          <h1 id="hero-titulo" className={styles.heroTitle}>
            Encontre os editais certos para o seu projeto
          </h1>
          <p className={styles.heroText}>
            O Edital Inteligente reúne editais de fomento, financiamentos, bolsas, programas de
            aceleração, premiações e outras oportunidades, organizados para você descobrir o que
            combina com o seu perfil sem precisar procurar em dezenas de sites.
          </p>
          <OpportunitySearchForm
            key={currentFiltersKey}
            appliedFilters={filters}
            onSearch={handleSearch}
            onClear={handleClear}
          />
        </Container>
      </section>

      <section className={styles.section} aria-labelledby="categorias-titulo">
        <Container>
          <SectionHeading
            id="categorias-titulo"
            title="Categorias de oportunidades"
            description="Explore os principais tipos de oportunidade acompanhados pela plataforma."
          />
          <ul className={styles.categoryGrid}>
            {publicCategories.map((category) => (
              <li key={category.code}>
                <CategoryCard category={category} />
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section
        id={OPPORTUNITIES_SECTION_ID}
        className={`${styles.section} ${styles.sectionAlt}`}
        aria-labelledby="oportunidades-titulo"
      >
        <Container>
          <SectionHeading
            id="oportunidades-titulo"
            title={isSearching ? 'Resultados da busca' : 'Oportunidades recentes'}
            description={
              isSearching
                ? 'Oportunidades que correspondem aos filtros selecionados.'
                : 'Editais e programas cadastrados mais recentemente na plataforma.'
            }
          />
          <OpportunityList
            filters={filters}
            page={page}
            onPageChange={handlePageChange}
            onClearFilters={handleClear}
            onOpenOpportunity={handleOpenOpportunity}
            gridClassName={styles.opportunityGrid}
          />
        </Container>
      </section>
    </>
  )
}

export default HomePage
