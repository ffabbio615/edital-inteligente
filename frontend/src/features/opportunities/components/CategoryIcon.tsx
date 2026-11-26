import type { OpportunityCategoryCode } from '../../../types/opportunity'

interface CategoryIconProps {
  category: OpportunityCategoryCode
  className?: string
}

/** Ícones SVG simples e decorativos (ocultos de leitores de tela). */
function CategoryIcon({ category, className }: CategoryIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {category === 'grant' && (
        <>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h5M10 16h5" />
        </>
      )}
      {category === 'financing' && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M14.5 9.5c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9-1.1 0-2-.4-2.5-1.2M12 7v1.3M12 15.7V17" />
        </>
      )}
      {category === 'scholarship' && (
        <>
          <path d="M3 9l9-4 9 4-9 4z" />
          <path d="M7 11v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4M21 9v5" />
        </>
      )}
      {category === 'acceleration' && (
        <>
          <path d="M4 18l6-6 3 3 7-7" />
          <path d="M15 8h5v5" />
        </>
      )}
      {category === 'award' && (
        <>
          <circle cx="12" cy="9" r="5" />
          <path d="M9 13.5L8 21l4-2 4 2-1-7.5" />
        </>
      )}
    </svg>
  )
}

export default CategoryIcon
