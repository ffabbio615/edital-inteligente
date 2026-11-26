import type { OpportunityCategoryPresentation } from '../../../types/opportunity-category'
import CategoryIcon from './CategoryIcon'
import styles from './CategoryCard.module.scss'

interface CategoryCardProps {
  category: OpportunityCategoryPresentation
}

function CategoryCard({ category }: CategoryCardProps) {
  return (
    <article className={styles.card}>
      <span className={styles.icon}>
        <CategoryIcon category={category.code} />
      </span>
      <h3 className={styles.title}>{category.displayName}</h3>
      <p className={styles.description}>{category.displayDescription}</p>
    </article>
  )
}

export default CategoryCard
