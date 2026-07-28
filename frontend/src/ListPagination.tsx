import { useTranslation } from 'react-i18next'

interface ListPaginationProps {
  page: number
  totalPages: number
  total: number
  totalUnit?: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  disabled?: boolean
  className?: string
}

export default function ListPagination({
  page,
  totalPages,
  total,
  totalUnit,
  canPrev,
  canNext,
  onPrev,
  onNext,
  disabled = false,
  className,
}: ListPaginationProps) {
  const { t } = useTranslation()
  const resolvedUnit = totalUnit ?? t('common.unitItems')

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className={['list-pagination', 'list-pagination-footer', className].filter(Boolean).join(' ')}>
      <div className="list-pagination-nav">
        <button type="button" className="secondary" disabled={!canPrev || disabled} onClick={onPrev}>
          {t('pagination.prev')}
        </button>
        <span className="list-page-info">
          {t('pagination.pageInfo', { page, totalPages })}
          <span className="list-total">{t('pagination.total', { total, unit: resolvedUnit })}</span>
        </span>
        <button type="button" className="secondary" disabled={!canNext || disabled} onClick={onNext}>
          {t('pagination.next')}
        </button>
      </div>
    </div>
  )
}
